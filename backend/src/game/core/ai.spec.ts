import assert from 'node:assert/strict';
import { Card, Player } from '../entities/game.entity';
import { GameEngine } from './game-engine';
import { selectBid, selectCardToPlay, selectKittyDiscard, selectFriendDeclaration, estimateHandScore } from './ai';
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
      context: {
        role: engine.getTeamRole(turn.id),
        playedCards: engine.getPlayedCards(),
        friendDeclaration: engine.state.friendDeclaration,
      },
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
      assert.equal(r.teamPoints + r.opponentPoints, collected);
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
