import assert from 'node:assert/strict';
import { Card, Player } from '../entities/game.entity';
import { GameEngine } from './game-engine';
import { selectBid, selectCardToPlay, selectKittyDiscard, selectFriendDeclaration, estimateHandScore } from './ai';
import {
  findVoidSuits,
  trickBeatenRisk,
  estimateOppositionGiruda,
  unseenCards,
  ownerTeamProbability,
  ownerTeamTrickChance,
  pointCardsGivenToOwner,
  pointsNotWonBy,
} from './ai-knowledge';
import { getMightyCard, getJokerCallCard, isMightyCard, MAX_BID, MIN_BID, TOTAL_TRICKS } from './rules';

function makePlayers(): Player[] {
  return Array.from({ length: 5 }, (_, i) => ({
    id: `p${i}`,
    socketId: '',
    username: `p${i}`,
    seat: (['bottom', 'left', 'top', 'center', 'right'] as const)[i],
    hand: [],
    isReady: false,
    isAi: true,
    collectedScoreCards: [],
    score: 0,
    isFriend: false,
    isOwner: false,
  }));
}

let seq = 0;
const card = (suit: Card['suit'], rank: Card['rank']): Card => ({
  id: `a${seq++}`,
  suit,
  rank,
  isJoker: suit === 'JOKER',
});
const joker = () => card('JOKER', '2');

/** Plays one complete game where every seat is driven by the AI, like the gateway does. */
function playAiGame(): { engine: GameEngine; revealedFriend: boolean } {
  const engine = new GameEngine({ players: makePlayers(), giruda: 'NO_GIRUDA' });
  engine.deal();

  let guard = 0;
  while (engine.state.phase === 'BIDDING') {
    assert.ok(guard++ < 500, 'bidding does not finish');
    const turn = engine.state.players[engine.state.currentTurnIndex];
    const d = selectBid({ hand: turn.hand, currentBid: engine.state.highestBid });
    if (d.bid !== null) assert.ok(d.bid >= MIN_BID && d.bid <= MAX_BID);
    engine.placeBid(turn.id, { pass: d.bid === null, score: d.bid ?? undefined, giruda: d.giruda ?? undefined });
  }

  const president = engine.state.players[engine.state.presidentIndex!];
  const discard = selectKittyDiscard({
    cards: [...president.hand, ...engine.state.kitty],
    giruda: engine.state.giruda as string,
  });
  engine.exchangeKitty(president.id, discard);
  engine.declareFriend(
    president.id,
    selectFriendDeclaration({
      hand: president.hand,
      giruda: engine.state.giruda as string,
      discarded: engine.state.kitty,
    })
  );

  guard = 0;
  while (engine.state.phase === 'TRICK_PLAYING' || engine.state.phase === 'TRICK_RESOLVED') {
    assert.ok(guard++ < 100, 'game does not finish');
    if (engine.state.phase === 'TRICK_RESOLVED') {
      engine.advanceAfterTrick();
      continue;
    }
    const turn = engine.state.players[engine.state.currentTurnIndex];
    const winner = engine.getCurrentTrickWinner();
    const d = selectCardToPlay({
      hand: turn.hand,
      leadSuit: engine.state.currentTrick?.leadSuit,
      currentTrickPlays: engine.state.currentTrick?.cards ?? [],
      giruda: engine.state.giruda as string,
      trickNumber: engine.state.currentTrickNumber,
      totalTricks: TOTAL_TRICKS,
      isPartnerWinningCurrentTrick: winner ? engine.isAllyOf(turn.id, winner.winnerPlayerId) : false,
      mightyCard: engine.mightyCard,
      jokerCallCard: engine.jokerCallCard,
      restrictGirudaLead: engine.restrictsGirudaLead(),
      isJokerCallActive: engine.state.isJokerCallActive,
      context: engine.getAiPlayContext(turn.id),
    });
    engine.playCard(turn.id, d.cardId, { jokerCall: d.jokerCall, jokerLeadSuit: d.jokerLeadSuit });
  }
  return { engine, revealedFriend: engine.state.friendIndex !== null };
}

describe('AI bidding', () => {
  test('the longest suit becomes the giruda', () => {
    const hand = [
      card('HEART', 'A'), card('HEART', 'K'), card('HEART', 'Q'), card('HEART', 'J'), card('HEART', '10'),
      card('HEART', '9'), card('SPADE', 'A'), card('CLUB', '4'), card('DIAMOND', '5'), joker(),
    ];
    const d = selectBid({ hand, currentBid: null });
    assert.equal(d.giruda, 'HEART');
    assert.ok(d.bid !== null && d.bid >= MIN_BID && d.bid <= MAX_BID);
  });

  test('a hand of aces and kings without a long suit goes no-giruda', () => {
    const hand = [
      card('SPADE', 'A'), card('SPADE', 'K'), card('DIAMOND', 'A'), card('DIAMOND', 'K'), card('HEART', 'A'),
      card('HEART', 'K'), card('CLUB', 'A'), card('CLUB', 'K'), joker(), card('SPADE', '5'),
    ];
    const d = selectBid({ hand, currentBid: null });
    assert.equal(d.giruda, 'NO_GIRUDA');
    assert.ok(d.bid !== null);
  });

  test('a weak hand passes', () => {
    const hand = [
      card('SPADE', '2'), card('SPADE', '3'), card('DIAMOND', '4'), card('DIAMOND', '5'), card('HEART', '6'),
      card('HEART', '7'), card('CLUB', '8'), card('CLUB', '9'), card('CLUB', '4'), card('SPADE', '6'),
    ];
    assert.equal(selectBid({ hand, currentBid: null }).bid, null);
  });

  test('never bids above the maximum and passes when it cannot outbid', () => {
    const hand = [
      card('HEART', 'A'), card('HEART', 'K'), card('HEART', 'Q'), card('HEART', 'J'), card('HEART', '10'),
      card('HEART', '9'), card('HEART', '8'), card('SPADE', 'A'), card('DIAMOND', 'A'), joker(),
    ];
    assert.ok(estimateHandScore(hand, 'HEART') > MAX_BID);
    assert.equal(selectBid({ hand, currentBid: null }).bid, MIN_BID);
    const d = selectBid({ hand, currentBid: { bidderIndex: 1, score: MAX_BID, giruda: 'NO_GIRUDA' } });
    assert.equal(d.bid, null);
    const d2 = selectBid({ hand, currentBid: { bidderIndex: 1, score: MAX_BID, giruda: 'SPADE' } });
    assert.equal(d2.bid, null);
  });
});

describe('AI kitty discard', () => {
  test('empties a short side suit and keeps joker, mighty, giruda and the joker call without a joker', () => {
    const cards = [
      card('HEART', 'A'), card('HEART', 'K'), card('HEART', '9'), card('HEART', '7'), card('SPADE', 'A'),
      card('DIAMOND', 'K'), card('DIAMOND', '6'), card('DIAMOND', '4'), card('CLUB', '3'), card('CLUB', '5'),
      card('CLUB', '9'), card('SPADE', '2'), card('DIAMOND', '9'),
    ];
    const { discardCardIds } = selectKittyDiscard({ cards, giruda: 'HEART' });
    const dropped = discardCardIds.map((id) => cards.find((c) => c.id === id)!);
    assert.equal(dropped.length, 3);
    assert.ok(dropped.every((c) => !isMightyCard(c, 'HEART') && c.suit !== 'HEART'));
    assert.ok(dropped.some((c) => c.suit === 'SPADE' && c.rank === '2'), 'the lone low spade goes first');
    assert.ok(dropped.every((c) => !(c.suit === 'CLUB' && c.rank === '3')));
  });
});

describe('AI friend declaration', () => {
  test('asks for the mighty first and for the giruda ace when it holds mighty and joker', () => {
    assert.deepEqual(selectFriendDeclaration({ hand: [card('CLUB', '4')], giruda: 'SPADE' }), { type: 'MIGHTY' });
    const hand = [card('DIAMOND', 'A'), joker()];
    assert.deepEqual(selectFriendDeclaration({ hand, giruda: 'SPADE' }), { type: 'CARD', suit: 'SPADE', rank: 'A' });
  });
});

describe('AI joker call and joker play', () => {
  const callPlay = (hand: Card[], extra: Partial<Parameters<typeof selectCardToPlay>[0]> = {}) =>
    selectCardToPlay({
      hand,
      currentTrickPlays: [],
      giruda: 'SPADE',
      trickNumber: 4,
      totalTricks: TOTAL_TRICKS,
      isPartnerWinningCurrentTrick: false,
      mightyCard: getMightyCard('SPADE'),
      jokerCallCard: getJokerCallCard('SPADE'),
      ...extra,
    });

  test('does not call the joker when it holds the joker or the joker was already played', () => {
    const call = card('CLUB', '3');
    const filler = [card('HEART', '9'), card('HEART', '4')];
    assert.notEqual(callPlay([call, joker(), ...filler]).jokerCall, true);
    assert.notEqual(callPlay([call, ...filler], { context: { playedCards: [joker()] } }).jokerCall, true);
    assert.equal(callPlay([call, ...filler], { context: { playedCards: [] } }).jokerCall, true);
  });

  test('a president who asked for the joker as friend does not call it', () => {
    const call = card('CLUB', '3');
    const d = callPlay([call, card('HEART', '9')], {
      context: { role: 'PRESIDENT', friendDeclaration: { type: 'JOKER' } },
    });
    assert.notEqual(d.jokerCall, true);
  });

  test('plays the joker in the second to last trick (it is powerless in the last)', () => {
    const j = joker();
    const hand = [j, card('HEART', '9')];
    const lead = callPlay(hand, { trickNumber: 9, jokerCallCard: undefined });
    assert.equal(lead.cardId, j.id);
    assert.ok(lead.jokerLeadSuit);
    const follow = callPlay(hand, {
      trickNumber: 9,
      leadSuit: 'CLUB',
      currentTrickPlays: [{ playerId: 'x', card: card('CLUB', '5') }],
    });
    assert.equal(follow.cardId, j.id);
  });

  test('a joker lead names the suit with the most score cards still out', () => {
    const j = joker();
    const hand = [j, card('SPADE', 'A'), card('SPADE', 'K'), card('SPADE', 'Q'), card('HEART', '4')];
    const played = [card('HEART', 'A'), card('HEART', 'K'), card('HEART', 'Q'), card('HEART', 'J')];
    const d = callPlay(hand, {
      giruda: 'CLUB',
      trickNumber: 9,
      jokerCallCard: undefined,
      mightyCard: getMightyCard('CLUB'),
      context: { playedCards: played },
    });
    assert.equal(d.cardId, j.id);
    assert.equal(d.jokerLeadSuit, 'DIAMOND');
  });
});

describe('AI play: teams and card counting', () => {
  const base = {
    giruda: 'HEART',
    totalTricks: TOTAL_TRICKS,
    mightyCard: getMightyCard('HEART'),
    jokerCallCard: getJokerCallCard('HEART'),
  };

  test('feeds a point card to a partner that cannot be beaten, otherwise dumps low', () => {
    const k = card('DIAMOND', 'K');
    const low = card('DIAMOND', '3');
    const plays = [
      { playerId: 'x', card: card('DIAMOND', '9') },
      { playerId: 'partner', card: getMightyCardInstance() },
    ];
    const hand = [k, low];
    const d = selectCardToPlay({
      ...base, hand, leadSuit: 'DIAMOND', trickNumber: 4, currentTrickPlays: plays, isPartnerWinningCurrentTrick: true,
    });
    assert.equal(d.cardId, k.id);
    assert.equal(d.reason, 'feed_partner');

    const open = selectCardToPlay({
      ...base, hand, leadSuit: 'DIAMOND', trickNumber: 4, currentTrickPlays: [plays[0]], isPartnerWinningCurrentTrick: true,
    });
    assert.equal(open.cardId, low.id);
  });

  test('does not waste the mighty or a trump on a trick without points', () => {
    const mighty = card('SPADE', 'A');
    const low = card('CLUB', '3');
    const d = selectCardToPlay({
      ...base,
      hand: [mighty, low],
      leadSuit: 'DIAMOND',
      trickNumber: 3,
      currentTrickPlays: [{ playerId: 'x', card: card('DIAMOND', '9') }],
      isPartnerWinningCurrentTrick: false,
    });
    assert.equal(d.cardId, low.id);

    const withPoints = selectCardToPlay({
      ...base,
      hand: [mighty, low],
      leadSuit: 'DIAMOND',
      trickNumber: 3,
      currentTrickPlays: [{ playerId: 'x', card: card('DIAMOND', 'K') }],
      isPartnerWinningCurrentTrick: false,
    });
    assert.equal(withPoints.cardId, mighty.id);
  });

  test('counts cards: leads a side-suit card that nothing unseen can beat', () => {
    const aceOfClubs = card('CLUB', 'A');
    const kingOfClubs = card('CLUB', 'K');
    const low = card('DIAMOND', '3');
    const d = selectCardToPlay({
      ...base,
      hand: [kingOfClubs, low],
      currentTrickPlays: [],
      trickNumber: 3,
      isPartnerWinningCurrentTrick: false,
      context: { role: 'OPPOSITION', playedCards: [aceOfClubs] },
    });
    assert.equal(d.cardId, kingOfClubs.id);
    assert.equal(d.reason, 'lead_master');
  });

  test('the opposition keeps its giruda when leading', () => {
    const trump = card('HEART', '9');
    const side = card('DIAMOND', '5');
    const d = selectCardToPlay({
      ...base,
      hand: [trump, side],
      currentTrickPlays: [],
      trickNumber: 3,
      isPartnerWinningCurrentTrick: false,
      context: { role: 'OPPOSITION' },
    });
    assert.equal(d.cardId, side.id);
  });
});

describe('AI play: partner safety, void tracking, giruda draining (#33)', () => {
  const base = {
    giruda: 'HEART',
    totalTricks: TOTAL_TRICKS,
    mightyCard: getMightyCard('HEART'),
    jokerCallCard: getJokerCallCard('HEART'),
  };
  const play = (playerId: string, c: Card) => ({ playerId, card: c });
  const hearts = (...ranks: Card['rank'][]) => ranks.map((r) => card('HEART', r));

  test('a friend with the mighty does not dump low when the president\'s J can still be beaten', () => {
    const mighty = card('SPADE', 'A');
    const low = card('DIAMOND', '4');
    const d = selectCardToPlay({
      ...base,
      hand: [mighty, low, card('DIAMOND', '5')],
      leadSuit: 'DIAMOND',
      trickNumber: 3,
      currentTrickPlays: [play('p0', card('DIAMOND', 'J'))],
      isPartnerWinningCurrentTrick: true,
      context: {
        role: 'FRIEND',
        friendDeclaration: { type: 'MIGHTY' },
        friendRevealed: false,
        playersBehind: ['p2', 'p3', 'p4'],
        knownAllyIds: ['p0'],
      },
    });
    assert.equal(d.cardId, mighty.id);
    assert.equal(d.reason, 'secure_partner_trick');
  });

  test('a friend dumps low when the partner\'s trick is safe enough without points at stake', () => {
    const low = card('DIAMOND', '4');
    const d = selectCardToPlay({
      ...base,
      hand: [card('SPADE', 'A'), low],
      leadSuit: 'DIAMOND',
      trickNumber: 3,
      currentTrickPlays: [play('p0', card('DIAMOND', '9'))],
      isPartnerWinningCurrentTrick: true,
      context: { role: 'FRIEND', playersBehind: ['p2', 'p3', 'p4'], knownAllyIds: ['p0'], rng: () => 0 },
    });
    assert.equal(d.cardId, low.id);
  });

  test('last to play with the partner winning: feeds a point card (also for the owner team)', () => {
    const k = card('DIAMOND', 'K');
    const d = selectCardToPlay({
      ...base,
      hand: [k, card('DIAMOND', '3')],
      leadSuit: 'DIAMOND',
      trickNumber: 4,
      currentTrickPlays: [play('a', card('DIAMOND', '4')), play('p0', card('DIAMOND', 'Q')), play('b', card('DIAMOND', '5')), play('c', card('DIAMOND', '6'))],
      isPartnerWinningCurrentTrick: true,
      context: { role: 'FRIEND', playersBehind: [], knownAllyIds: ['p0'] },
    });
    assert.equal(d.cardId, k.id);
    assert.equal(d.reason, 'feed_partner');
  });

  describe('friend does not cover the president\'s giruda master with the mighty', () => {
    const friendFollow = (hand: Card[], trickNumber: number, plays: ReturnType<typeof play>[], extra = {}) =>
      selectCardToPlay({
        ...base,
        hand,
        leadSuit: 'HEART',
        trickNumber,
        currentTrickPlays: plays,
        isPartnerWinningCurrentTrick: true,
        context: {
          role: 'FRIEND',
          friendDeclaration: { type: 'MIGHTY' },
          friendRevealed: false,
          playersBehind: ['p2', 'p3', 'p4'],
          knownAllyIds: ['p0'],
          rng: () => 0,
          ...extra,
        },
      });

    // Seven cards left (mid game): the joker alone is enough to push the beaten risk over the limit.
    const midHand = ['2', '3', '5', '6', '7'].map((r) => card('DIAMOND', r as Card['rank']));

    test('keeps the mighty and feeds a side-suit point card', () => {
      const mighty = card('SPADE', 'A');
      const k = card('DIAMOND', 'K');
      const d = friendFollow([mighty, k, ...midHand], 4, [play('p0', card('HEART', 'A'))]);
      assert.equal(d.cardId, k.id);
      assert.equal(d.reason, 'feed_partner');
    });

    test('keeps the mighty and dumps low without a point card', () => {
      const mighty = card('SPADE', 'A');
      const d = friendFollow([mighty, ...midHand], 4, [play('p0', card('HEART', 'A'))]);
      assert.equal(d.cardId, midHand[0].id);
      assert.equal(d.reason, 'partner_winning_dump');
    });

    test('still covers a giruda that is not the master (a higher giruda is unseen)', () => {
      const mighty = card('SPADE', 'A');
      const d = friendFollow([mighty, card('DIAMOND', '4'), ...midHand], 4, [play('p0', card('HEART', 'K'))]);
      assert.equal(d.cardId, mighty.id);
      assert.equal(d.reason, 'secure_partner_trick');
    });

    test('regression: in the last tricks the mighty may still cover the master', () => {
      const mighty = card('SPADE', 'A');
      const d = friendFollow([mighty, ...midHand], TOTAL_TRICKS - 1, [play('p0', card('HEART', 'A'))]);
      assert.equal(d.cardId, mighty.id);
      assert.equal(d.reason, 'secure_partner_trick');
    });

    test('regression: an opposing card winning with points is still taken with the mighty', () => {
      const mighty = card('SPADE', 'A');
      const d = selectCardToPlay({
        ...base,
        hand: [mighty, card('DIAMOND', '4')],
        leadSuit: 'HEART',
        trickNumber: 4,
        currentTrickPlays: [play('o1', card('HEART', 'A'))],
        isPartnerWinningCurrentTrick: false,
        context: { role: 'FRIEND', friendDeclaration: { type: 'MIGHTY' }, friendRevealed: false, playersBehind: ['p2', 'p3', 'p4'], knownAllyIds: ['p0'] },
      });
      assert.equal(d.cardId, mighty.id);
      assert.equal(d.reason, 'win_cheaply');
    });
  });

  describe('opposition feeding a fellow opposition player', () => {
    const lead = (playersBehind: string[], plays: ReturnType<typeof play>[], friendRevealed: boolean, extra = {}) => {
      const k = card('DIAMOND', 'K');
      const low = card('DIAMOND', '3');
      const d = selectCardToPlay({
        ...base,
        hand: [k, low],
        leadSuit: 'DIAMOND',
        trickNumber: 4,
        currentTrickPlays: plays,
        isPartnerWinningCurrentTrick: true,
        context: {
          role: 'OPPOSITION',
          friendRevealed,
          friendDeclaration: { type: 'NO_FRIEND' },
          playersBehind,
          knownAllyIds: ['o2'],
          rng: () => 0,
          ...extra,
        },
      });
      return { d, k, low };
    };

    test('feeds when it is last and the team is known', () => {
      const plays = [play('x', card('DIAMOND', '4')), play('o2', card('DIAMOND', 'Q')), play('y', card('DIAMOND', '5')), play('z', card('DIAMOND', '6'))];
      const { d, k } = lead([], plays, true);
      assert.equal(d.cardId, k.id);
    });

    test('does not feed when somebody behind can still turn the trick over', () => {
      const plays = [play('o2', card('DIAMOND', '9'))];
      const { d, low } = lead(['x', 'y', 'z'], plays, true);
      assert.equal(d.cardId, low.id);
      assert.equal(d.reason, 'partner_winning_dump');
    });

    test('does not feed before the friend is revealed', () => {
      const plays = [play('x', card('DIAMOND', '4')), play('o2', card('DIAMOND', 'Q')), play('y', card('DIAMOND', '5')), play('z', card('DIAMOND', '6'))];
      const { d, k } = lead([], plays, false);
      // The partner is unknown, so the AI plays its own trick (it can still win it) instead of feeding.
      assert.notEqual(d.reason, 'feed_partner');
      assert.equal(d.cardId, k.id);
    });

    test('never feeds the mighty, the joker or the joker call card', () => {
      const mighty = card('SPADE', 'A');
      const call = card('CLUB', '3');
      const d = selectCardToPlay({
        ...base,
        hand: [mighty, joker(), call],
        leadSuit: 'DIAMOND',
        trickNumber: 4,
        currentTrickPlays: [play('x', card('DIAMOND', '4')), play('o2', card('DIAMOND', 'Q')), play('y', card('DIAMOND', '5')), play('z', card('DIAMOND', '6'))],
        isPartnerWinningCurrentTrick: true,
        context: { role: 'OPPOSITION', friendRevealed: true, playersBehind: [], knownAllyIds: ['o2'] },
      });
      assert.notEqual(d.reason, 'feed_partner');
    });

    test('does not give points to a trick the owner team is winning', () => {
      const k = card('DIAMOND', 'K');
      const low = card('DIAMOND', '3');
      const d = selectCardToPlay({
        ...base,
        hand: [k, low],
        leadSuit: 'DIAMOND',
        trickNumber: 4,
        currentTrickPlays: [play('p0', getMightyCardInstance())],
        isPartnerWinningCurrentTrick: false,
        context: { role: 'OPPOSITION', friendRevealed: true, rng: () => 0 },
      });
      assert.equal(d.cardId, low.id);
    });
  });

  describe('void tracking', () => {
    const tricks = [
      {
        leadSuit: 'DIAMOND',
        cards: [play('p0', card('DIAMOND', '5')), play('p1', card('CLUB', '4')), play('p2', card('SPADE', 'A')), play('p3', joker()), play('p4', card('DIAMOND', '9'))],
      },
    ];

    test('a player who did not follow is void in the lead suit; mighty/joker/leader prove nothing', () => {
      const voids = findVoidSuits(tricks, 'HEART');
      assert.ok(voids.get('p1')?.has('DIAMOND'));
      assert.equal(voids.has('p0'), false);
      assert.equal(voids.has('p2'), false);
      assert.equal(voids.has('p3'), false);
      assert.equal(voids.has('p4'), false);
    });

    test('a void player is assumed able to cut with the giruda', () => {
      const best = card('DIAMOND', 'A');
      const unseen = [card('HEART', '9'), ...(['2', '3', '4', '5'] as const).map((r) => card('DIAMOND', r)), ...Array.from({ length: 7 }, () => card('CLUB', '2'))];
      const common = { bestCard: best, leadSuit: 'DIAMOND', giruda: 'HEART', jokerPowerless: false, unseen, cardsPerOpponent: 5 };
      const withVoid = trickBeatenRisk({ ...common, opponents: [{ voids: new Set(['DIAMOND']) }] });
      const noVoidInfo = trickBeatenRisk({ ...common, opponents: [{ voids: new Set() }] });
      // Plenty of diamonds are unseen => an unknown opponent probably still follows; a known void one cuts.
      assert.ok(withVoid > noVoidInfo, `${withVoid} > ${noVoidInfo}`);
    });

    test('a player known to have no giruda cannot cut', () => {
      const unseen = [card('HEART', '9'), card('HEART', '8')];
      const risk = trickBeatenRisk({
        bestCard: card('DIAMOND', 'A'),
        leadSuit: 'DIAMOND',
        giruda: 'HEART',
        jokerPowerless: false,
        unseen,
        cardsPerOpponent: 1,
        opponents: [{ voids: new Set(['DIAMOND', 'HEART']) }],
      });
      assert.equal(risk, 0);
    });

    test('opposition giruda count excludes played, own and known ally cards and is 0 when all are void', () => {
      const n = estimateOppositionGiruda({
        hand: hearts('A', 'K'),
        played: hearts('2', '3', '4'),
        giruda: 'HEART',
        allyCards: [{ suit: 'HEART', rank: 'Q' }],
        opponents: [{ voids: new Set() }],
      });
      assert.equal(n, 13 - 2 - 3 - 1);
      const none = estimateOppositionGiruda({ hand: [], played: [], giruda: 'HEART', opponents: [{ voids: new Set(['HEART']) }] });
      assert.equal(none, 0);
    });
  });

  describe('draining the opposition giruda as the owner team', () => {
    const ctx = (role: 'FRIEND' | 'PRESIDENT' | 'OPPOSITION', extra = {}) => ({
      role,
      friendRevealed: true,
      playersBehind: ['a', 'b', 'c', 'd'],
      knownAllyIds: [],
      rng: () => 0,
      ...extra,
    });

    test('a friend leading with the opposition giruda still out leads the giruda', () => {
      const trump = card('HEART', 'K');
      const d = selectCardToPlay({
        ...base,
        hand: [trump, card('HEART', '5'), card('DIAMOND', '4'), card('CLUB', '9')],
        currentTrickPlays: [],
        trickNumber: 4,
        isPartnerWinningCurrentTrick: false,
        context: ctx('FRIEND'),
      });
      assert.equal(d.cardId, trump.id);
      assert.equal(d.reason, 'drain_giruda');
    });

    test('a weak giruda is not led into higher unseen trumps', () => {
      const d = selectCardToPlay({
        ...base,
        hand: [card('HEART', '5'), card('HEART', '4'), card('DIAMOND', '4')],
        currentTrickPlays: [],
        trickNumber: 4,
        isPartnerWinningCurrentTrick: false,
        context: ctx('FRIEND'),
      });
      assert.notEqual(d.reason, 'drain_giruda');
    });

    test('a friend with the joker leads it naming the giruda (middle tricks only)', () => {
      const j = joker();
      const hand = [j, card('HEART', '5'), card('DIAMOND', '4'), card('CLUB', '9')];
      const mightyPlayed = [card('SPADE', 'A')];
      const d = selectCardToPlay({
        ...base,
        hand,
        currentTrickPlays: [],
        trickNumber: 4,
        isPartnerWinningCurrentTrick: false,
        context: ctx('FRIEND', { playedCards: mightyPlayed }),
      });
      assert.equal(d.cardId, j.id);
      assert.equal(d.jokerLeadSuit, 'HEART');
      assert.equal(d.reason, 'drain_giruda_joker');
      // First trick: the joker cannot lead; the call to lead a trump is not made.
      const first = selectCardToPlay({
        ...base,
        hand,
        currentTrickPlays: [],
        trickNumber: 1,
        isPartnerWinningCurrentTrick: false,
        context: ctx('FRIEND', { playedCards: mightyPlayed }),
      });
      assert.notEqual(first.cardId, j.id);
      // Last trick: the joker is powerless.
      const last = selectCardToPlay({
        ...base,
        hand: [j, card('HEART', '5')],
        currentTrickPlays: [],
        trickNumber: TOTAL_TRICKS,
        isPartnerWinningCurrentTrick: false,
        context: ctx('FRIEND', { playedCards: mightyPlayed }),
      });
      assert.notEqual(last.reason, 'drain_giruda_joker');
    });

    test('with the opposition giruda used up it leads a lead-keeping card and saves the joker', () => {
      const j = joker();
      const kd = card('DIAMOND', 'K');
      const hand = [j, kd, card('DIAMOND', '3'), ...hearts('10', 'J', 'Q', 'K', 'A')];
      const played = [...hearts('2', '3', '4', '5', '6', '7', '8', '9'), card('DIAMOND', 'A'), card('SPADE', 'A')];
      const d = selectCardToPlay({
        ...base,
        hand,
        currentTrickPlays: [],
        trickNumber: 4,
        isPartnerWinningCurrentTrick: false,
        context: ctx('FRIEND', { playedCards: played }),
      });
      assert.equal(d.cardId, kd.id);
      assert.equal(d.reason, 'lead_master');
    });

    test('opposition AIs are not affected and the first-trick giruda ban still holds', () => {
      const trump = card('HEART', 'K');
      const side = card('DIAMOND', '4');
      const opp = selectCardToPlay({
        ...base,
        hand: [trump, card('HEART', '5'), side],
        currentTrickPlays: [],
        trickNumber: 4,
        isPartnerWinningCurrentTrick: false,
        context: ctx('OPPOSITION'),
      });
      assert.equal(opp.cardId, side.id);
      const first = selectCardToPlay({
        ...base,
        hand: [trump, side],
        currentTrickPlays: [],
        trickNumber: 1,
        isPartnerWinningCurrentTrick: false,
        restrictGirudaLead: true,
        context: ctx('PRESIDENT'),
      });
      assert.equal(first.cardId, side.id);
    });

    test('no giruda: nothing to drain', () => {
      const d = selectCardToPlay({
        ...base,
        giruda: 'NO_GIRUDA',
        hand: [card('HEART', 'K'), card('DIAMOND', '4')],
        currentTrickPlays: [],
        trickNumber: 4,
        isPartnerWinningCurrentTrick: false,
        context: ctx('FRIEND'),
      });
      assert.notEqual(d.reason, 'drain_giruda');
    });
  });

  describe('friend reveal timing', () => {
    test('a friend holding the declared mighty leads it from the middle game instead of waiting for the end', () => {
      const mighty = card('SPADE', 'A');
      const d = selectCardToPlay({
        ...base,
        hand: [mighty, card('DIAMOND', '4'), card('CLUB', '9')],
        currentTrickPlays: [],
        trickNumber: 5,
        isPartnerWinningCurrentTrick: false,
        context: { role: 'FRIEND', friendDeclaration: { type: 'MIGHTY' }, friendRevealed: false, rng: () => 0 },
      });
      assert.equal(d.cardId, mighty.id);
    });
  });

  describe('variety', () => {
    test('equal dump candidates vary with the rng but the choice is never a clear loss', () => {
      const three = card('DIAMOND', '3');
      const four = card('DIAMOND', '4');
      const nine = card('DIAMOND', '9');
      const run = (r: number) =>
        selectCardToPlay({
          ...base,
          hand: [three, four, nine],
          leadSuit: 'DIAMOND',
          trickNumber: 3,
          currentTrickPlays: [play('x', card('DIAMOND', 'A'))],
          isPartnerWinningCurrentTrick: false,
          context: { rng: () => r },
        });
      const picks = new Set([0, 0.99].map((r) => run(r).cardId));
      assert.deepEqual(picks, new Set([three.id, four.id]));
      for (let i = 0; i < 20; i++) assert.notEqual(run(Math.random()).cardId, nine.id);
    });

    test('same seed, same decision', () => {
      const hand = [card('DIAMOND', '3'), card('DIAMOND', '4'), card('CLUB', '5'), card('CLUB', '6')];
      const decide = () =>
        selectCardToPlay({ ...base, hand, currentTrickPlays: [], trickNumber: 3, isPartnerWinningCurrentTrick: false, context: { role: 'OPPOSITION', rng: () => 0.5 } }).cardId;
      assert.equal(decide(), decide());
    });
  });

  describe('information boundary', () => {
    test('the AI context holds only the viewer\'s role and public data, never another hand', () => {
      const engine = new GameEngine({ players: makePlayers(), giruda: 'HEART' });
      engine.deal();
      const ctx = engine.getAiPlayContext('p1');
      assert.deepEqual(Object.keys(ctx).sort(), [
        'bidScore', 'friendDeclaration', 'friendRevealed', 'knownAllyIds', 'ownerPlayerId', 'playedCards', 'playersBehind', 'role', 'selfId', 'tricks',
      ]);
      assert.equal(ctx.playedCards?.length, 0);
      assert.deepEqual(ctx.knownAllyIds, []);
      const handIds = new Set(engine.state.players.flatMap((p) => p.hand.map((c) => c.id)));
      assert.ok(!JSON.stringify(ctx).split('"').some((t) => handIds.has(t) && t.length > 0 && /^\d+$/.test(t)));
    });

    test('unseenCards removes only the given cards', () => {
      const unseen = unseenCards([card('SPADE', 'A'), joker()], [{ suit: 'HEART', rank: 'K' }]);
      assert.equal(unseen.length, 53 - 3);
    });
  });
});

describe('AI play: opposition adds score cards (#44)', () => {
  const base = {
    giruda: 'HEART',
    totalTricks: TOTAL_TRICKS,
    mightyCard: getMightyCard('HEART'),
    jokerCallCard: getJokerCallCard('HEART'),
    isPartnerWinningCurrentTrick: false,
  };
  const play = (playerId: string, c: Card) => ({ playerId, card: c });
  const none = new Set<string>();

  describe('ownerTeamProbability / ownerTeamTrickChance (pure)', () => {
    const common = { ownerPlayerId: 'p0', knownAllyIds: ['o1'], friendDeclaration: { type: 'MIGHTY' } };
    test('the president is always owner team; before the reveal the others are the friend with 1/3', () => {
      assert.equal(ownerTeamProbability({ ...common, otherId: 'p0', friendRevealed: false }), 1);
      assert.equal(ownerTeamProbability({ ...common, otherId: 'x', friendRevealed: false }), 1 / 3);
      assert.equal(ownerTeamProbability({ ...common, otherId: 'x', friendRevealed: false, friendDeclaration: { type: 'NO_FRIEND' } }), 0);
    });
    test('after the reveal the known allies are opposition and everybody else is owner team', () => {
      assert.equal(ownerTeamProbability({ ...common, otherId: 'o1', friendRevealed: true }), 0);
      assert.equal(ownerTeamProbability({ ...common, otherId: 'f', friendRevealed: true }), 1);
    });

    const unseen = unseenCards([card('DIAMOND', '10'), card('DIAMOND', '3')]);
    const chance = (best: Card, bestProb: number, probs: number[]) =>
      ownerTeamTrickChance({
        bestCard: best, bestOwnerTeamProb: bestProb, leadSuit: 'DIAMOND', giruda: 'HEART', jokerPowerless: false,
        unseen, behind: probs.map((p) => ({ ownerTeamProb: p, voids: none })), cardsPerOpponent: 7,
      });
    test('nobody behind: the current best simply wins', () => {
      assert.equal(chance(card('DIAMOND', 'A'), 1, []), 1);
      assert.equal(chance(card('DIAMOND', 'A'), 0, []), 0);
      assert.equal(chance(card('DIAMOND', 'A'), 1 / 3, []), 1 / 3);
    });
    test('the owner team\'s chance falls with more seats behind and with a weaker best card', () => {
      const fewer = chance(card('DIAMOND', '9'), 1, [0, 0]);
      const more = chance(card('DIAMOND', '9'), 1, [0, 0, 0]);
      assert.ok(more < fewer, `${more} < ${fewer}`);
      assert.ok(chance(card('DIAMOND', '5'), 1, [0, 0]) < chance(card('DIAMOND', 'A'), 1, [0, 0]));
      // Seats that may be owner team threaten an opposition card instead.
      assert.ok(chance(card('DIAMOND', '5'), 0, [1, 1]) > chance(card('DIAMOND', '5'), 0, [0, 0]));
      assert.equal(chance(card('DIAMOND', '5'), 0, [0, 0]), 0);
    });
  });

  describe('public trick history helpers', () => {
    const tricks = [
      { leadSuit: 'DIAMOND', winnerPlayerId: 'p0', cards: [play('p0', card('DIAMOND', 'A')), play('me', card('DIAMOND', '10')), play('x', card('DIAMOND', '2'))] },
      { leadSuit: 'CLUB', winnerPlayerId: 'x', cards: [play('x', card('CLUB', 'K')), play('me', card('CLUB', '2')), play('p0', card('CLUB', '3'))] },
    ];
    test('counts score cards that left the president and the ones the AI gave him', () => {
      assert.equal(pointsNotWonBy(tricks, 'p0'), 1);
      assert.equal(pointCardsGivenToOwner(tricks, 'me', 'p0'), 1);
      assert.equal(pointCardsGivenToOwner(tricks, 'x', 'p0'), 0);
    });
  });

  describe('selectCardToPlay', () => {
    const lowCards = () => ['4', '5', '6', '7', '8'].map((r) => card('CLUB', r as Card['rank']));
    const follow = (plays: ReturnType<typeof play>[], behind: string[], ctx: Record<string, unknown> = {}, opts: { hand?: Card[]; trickNumber?: number; partner?: boolean } = {}) => {
      const ten = card('DIAMOND', '10');
      const king = card('DIAMOND', 'K');
      const three = card('DIAMOND', '3');
      const hand = opts.hand ?? [ten, three, ...lowCards()];
      const d = selectCardToPlay({
        ...base,
        isPartnerWinningCurrentTrick: !!opts.partner,
        hand,
        leadSuit: 'DIAMOND',
        trickNumber: opts.trickNumber ?? 4,
        currentTrickPlays: plays,
        context: {
          role: 'OPPOSITION',
          selfId: 'me',
          ownerPlayerId: 'p0',
          bidScore: 14,
          friendRevealed: false,
          friendDeclaration: { type: 'MIGHTY' },
          playersBehind: behind,
          knownAllyIds: [],
          rng: () => 0,
          ...ctx,
        },
      });
      return { d, ten, king, three, hand };
    };

    test('situation 1: before the reveal, feeds the weakest score card to a non-president who will win', () => {
      const { d, ten } = follow([play('p0', card('DIAMOND', '4')), play('x', card('DIAMOND', 'A'))], []);
      assert.equal(d.reason, 'feed_opposition');
      assert.equal(d.cardId, ten.id);
    });

    test('situation 1: after the reveal, a known fellow opposition player winning last gets points (feed_partner)', () => {
      const { d } = follow([play('p0', card('DIAMOND', '4')), play('o1', card('DIAMOND', 'A'))], [], { friendRevealed: true, knownAllyIds: ['o1'] }, { partner: true });
      assert.equal(d.reason, 'feed_partner');
    });

    test('situation 1: no points when the current winner may well be the hidden friend and could still lose', () => {
      // A low card by a non-president with two players behind: not safe enough for the opposition.
      const { d } = follow([play('p0', card('DIAMOND', '2')), play('x', card('DIAMOND', 'J'))], ['y', 'z']);
      assert.notEqual(d.reason, 'feed_opposition');
      assert.equal(d.reason, 'dump_low');
    });

    test('situation 2: the president\'s lead probably gets beaten, so a score card is added instead of dump_low', () => {
      const { d, ten } = follow([play('p0', card('DIAMOND', 'J'))], ['a', 'b'], { friendRevealed: true, knownAllyIds: ['a', 'b'] });
      assert.equal(d.reason, 'feed_opposition');
      assert.equal(d.cardId, ten.id);
    });

    test('situation 2: last to play with the president winning gives no points, whatever the friend state', () => {
      for (const revealed of [true, false]) {
        const { d, three } = follow([play('a', card('DIAMOND', '2')), play('p0', card('DIAMOND', 'A'))], [], { friendRevealed: revealed });
        assert.equal(d.cardId, three.id);
        assert.equal(d.reason, 'dump_low');
      }
    });

    test('a safe president lead with few players behind is not fed', () => {
      const { d, three } = follow([play('a', card('DIAMOND', '2')), play('p0', card('DIAMOND', 'A'))], ['b']);
      assert.equal(d.cardId, three.id);
    });

    test('winning the trick (win_cheaply) has priority over feeding', () => {
      const king = card('DIAMOND', 'K');
      const { d } = follow([play('p0', card('DIAMOND', 'Q'))], ['a', 'b', 'c'], { friendRevealed: true }, { hand: [card('DIAMOND', '10'), king, ...lowCards()] });
      // The AI can beat the president's queen with its king.
      assert.equal(d.reason, 'win_cheaply');
      assert.equal(d.cardId, king.id);
    });

    test('never feeds the mighty, the joker or the joker call card', () => {
      const mighty = card('SPADE', 'A');
      const call = card('CLUB', '3');
      const d = selectCardToPlay({
        ...base,
        hand: [joker(), call, card('DIAMOND', '3')],
        leadSuit: 'DIAMOND',
        trickNumber: 4,
        currentTrickPlays: [play('p0', card('DIAMOND', 'J'))],
        context: { role: 'OPPOSITION', selfId: 'me', ownerPlayerId: 'p0', friendRevealed: true, playersBehind: ['a', 'b', 'c'], knownAllyIds: [], rng: () => 0 },
      });
      assert.notEqual(d.reason, 'feed_opposition');
      assert.notEqual(d.reason, 'lure_friend');
      assert.ok(mighty);
    });

    describe('situation 3: sacrificing a weak score card to draw the friend out', () => {
      // Trick 4, the president leads a diamond ace with three players behind: likely overturned by the mighty/joker.
      const lure = (ctx: Record<string, unknown> = {}, opts: { hand?: Card[]; trickNumber?: number } = {}) =>
        follow([play('p0', card('DIAMOND', 'A'))], ['a', 'b', 'c'], ctx, opts);

      test('sacrifices the weakest score card when the mighty is declared and the friend is hidden', () => {
        const { d, ten } = lure();
        assert.equal(d.reason, 'lure_friend');
        assert.equal(d.cardId, ten.id);
      });

      test('works for a joker and a card declaration, not for NO_FRIEND / FIRST_TRICK', () => {
        assert.equal(lure({ friendDeclaration: { type: 'JOKER' } }).d.reason, 'lure_friend');
        assert.equal(lure({ friendDeclaration: { type: 'CARD', suit: 'HEART', rank: 'A' } }).d.reason, 'lure_friend');
        assert.notEqual(lure({ friendDeclaration: { type: 'NO_FRIEND' } }).d.reason, 'lure_friend');
        assert.notEqual(lure({ friendDeclaration: { type: 'FIRST_TRICK' } }).d.reason, 'lure_friend');
      });

      test('not once the friend is revealed', () => {
        assert.notEqual(lure({ friendRevealed: true, knownAllyIds: [] }).d.reason, 'lure_friend');
      });

      test('not when the AI holds the declared card itself', () => {
        const hand = [card('SPADE', 'A'), card('DIAMOND', '10'), card('DIAMOND', '3'), ...lowCards()];
        assert.notEqual(lure({}, { hand }).d.reason, 'lure_friend');
      });

      test('limit: only once per game (a score card already given to a president trick counts)', () => {
        const earlier = [
          { leadSuit: 'CLUB', winnerPlayerId: 'p0', cards: [play('p0', card('CLUB', 'A')), play('me', card('CLUB', 'J'))] },
        ];
        assert.notEqual(lure({ tricks: earlier }).d.reason, 'lure_friend');
        // A score card that went to somebody else does not count against the limit.
        const elsewhere = [
          { leadSuit: 'CLUB', winnerPlayerId: 'x', cards: [play('x', card('CLUB', 'A')), play('me', card('CLUB', '2'))] },
        ];
        assert.equal(lure({ tricks: elsewhere }).d.reason, 'lure_friend');
      });

      test('gain/loss guard: not when the opposition already has enough points to stop the bid', () => {
        // Bid 14 needs the opposition at 7+; points that did not go to the president: 7.
        const sevenPoints = [
          { leadSuit: 'CLUB', winnerPlayerId: 'x', cards: ['10', 'J', 'Q', 'K', 'A'].map((r, i) => play(`q${i}`, card('CLUB', r as Card['rank']))) },
          { leadSuit: 'SPADE', winnerPlayerId: 'y', cards: [play('q0', card('SPADE', '10')), play('q1', card('SPADE', 'J'))] },
        ];
        assert.notEqual(lure({ tricks: sevenPoints, bidScore: 14 }).d.reason, 'lure_friend');
        // Bid 13 needs the opposition at 8+: seven is not enough yet, so the lure is still allowed.
        assert.equal(lure({ tricks: sevenPoints, bidScore: 13 }).d.reason, 'lure_friend');
      });

      test('guard: not in the last tricks', () => {
        assert.notEqual(lure({}, { trickNumber: TOTAL_TRICKS - 1 }).d.reason, 'lure_friend');
      });

      test('not when the president is not the one winning the trick, or leads (no card yet)', () => {
        const { d } = follow([play('p0', card('DIAMOND', '2')), play('x', card('DIAMOND', 'A'))], ['a', 'b', 'c']);
        assert.notEqual(d.reason, 'lure_friend');
      });

      test('the lure uses no score card besides the weakest one', () => {
        const { d, hand } = lure();
        const chosen = hand.find((c) => c.id === d.cardId)!;
        assert.equal(chosen.rank, '10');
      });
    });
  });
});

function getMightyCardInstance(): Card {
  return card('SPADE', 'A');
}

describe('AI self-play simulation', () => {
  test('full games with every seat on the AI finish legally and keep the bid within 13~20', () => {
    const N = 150;
    let ownerWins = 0;
    let withFriend = 0;
    const roles = { OWNER: 0, FRIEND: 0, OPPOSER: 0 };
    for (let g = 0; g < N; g++) {
      const { engine } = playAiGame();
      assert.equal(engine.state.phase, 'GAME_OVER');
      const r = engine.getResult();
      assert.ok(r.bidScore >= MIN_BID && r.bidScore <= MAX_BID);
      const collected = engine.state.players.reduce((s, p) => s + p.collectedScoreCards.length, 0);
      assert.equal(r.teamPoints + r.opponentPoints, collected + r.kittyPoints);
      if (r.isWin) ownerWins++;
      if (r.friendPlayerId) withFriend++;
      for (const p of r.players) roles[p.role]++;
    }
    // Not a strict balance check: the president must neither always win nor always lose.
    const rate = ownerWins / N;
    assert.ok(rate > 0.05 && rate < 0.95, `president win rate ${rate} is degenerate`);
    assert.ok(withFriend > 0, 'some presidents get a friend');
    assert.equal(roles.OWNER, N);
  });
});
