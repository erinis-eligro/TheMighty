import assert from 'node:assert/strict';
import { Card, Player } from '../entities/game.entity';
import { GameEngine } from './game-engine';
import { selectCardToPlay } from './ai';
import { validatePlay, determineTrickWinner } from './trick';
import { getMightyCard, getJokerCallCard, isJokerPowerless, TOTAL_TRICKS } from './rules';

let seq = 0;
const card = (suit: Card['suit'], rank: Card['rank']): Card => ({
  id: `c${seq++}`,
  suit,
  rank,
  isJoker: suit === 'JOKER',
});
const joker = () => card('JOKER', '2');

const base = { totalTricks: TOTAL_TRICKS, giruda: 'HEART' };

test('joker call card is NOT forced when the joker call is not active', () => {
  const callCard = card('CLUB', '3');
  const lead = card('DIAMOND', '5');
  const hand = [callCard, card('DIAMOND', '9')];
  // Following diamonds without a declared call: must follow suit, but no forced call card.
  assert.equal(validatePlay({ ...base, card: hand[1], hand, leadSuit: 'DIAMOND', trickNumber: 3 }).valid, true);
  void lead;
});

test('joker call: only the leader can declare, and only with the joker-call card', () => {
  const callCard = card('CLUB', '3');
  const other = card('DIAMOND', '9');
  const hand = [callCard, other];
  const lead = { ...base, hand, isLeading: true, trickNumber: 3 };
  assert.equal(validatePlay({ ...lead, card: callCard, declaresJokerCall: true }).valid, true);
  assert.equal(
    validatePlay({ ...lead, card: other, declaresJokerCall: true }).reason,
    'joker_call_requires_joker_call_card'
  );
  assert.equal(
    validatePlay({ ...base, hand, card: callCard, leadSuit: 'DIAMOND', isLeading: false, trickNumber: 3, declaresJokerCall: true })
      .reason,
    'joker_call_only_when_leading'
  );
});

test('joker call card follows the giruda: SPADE 3 when giruda is CLUB, CLUB 3 otherwise', () => {
  assert.deepEqual(getJokerCallCard('CLUB'), { suit: 'SPADE', rank: '3' });
  const spade3 = card('SPADE', '3');
  const hand = [spade3, card('HEART', '4')];
  const r = validatePlay({ card: spade3, hand, isLeading: true, trickNumber: 4, totalTricks: 10, giruda: 'CLUB', declaresJokerCall: true });
  assert.equal(r.valid, true);
  const club3 = card('CLUB', '3');
  const r2 = validatePlay({ card: club3, hand: [club3], isLeading: true, trickNumber: 4, totalTricks: 10, giruda: 'CLUB', declaresJokerCall: true });
  assert.equal(r2.reason, 'joker_call_requires_joker_call_card');
});

test('joker call active: a follower holding the call card must play it', () => {
  const callCard = card('CLUB', '3');
  const other = card('DIAMOND', '9');
  const hand = [callCard, other];
  const args = { ...base, hand, leadSuit: 'DIAMOND', isLeading: false, trickNumber: 3, isJokerCallActive: true };
  assert.equal(validatePlay({ ...args, card: other }).reason, 'must_play_joker_call_card');
  assert.equal(validatePlay({ ...args, card: callCard }).valid, true);
});

test('joker: needs a named suit to lead, cannot lead the first trick, exempt from following suit', () => {
  const j = joker();
  const hand = [j, card('SPADE', '5')];
  const lead = { ...base, card: j, hand, isLeading: true };
  assert.equal(validatePlay({ ...lead, trickNumber: 2 }).reason, 'joker_lead_suit_required');
  assert.equal(validatePlay({ ...lead, trickNumber: 2, jokerLeadSuit: 'STAR' }).reason, 'joker_lead_suit_required');
  assert.equal(validatePlay({ ...lead, trickNumber: 2, jokerLeadSuit: 'SPADE' }).valid, true);
  assert.equal(validatePlay({ ...lead, trickNumber: 1, jokerLeadSuit: 'SPADE' }).reason, 'joker_cannot_lead_first_trick');
  // last trick: the suit must be named too, otherwise the winner cannot be decided by rank
  assert.equal(validatePlay({ ...lead, hand: [j], trickNumber: 10 }).reason, 'joker_lead_suit_required');
  assert.equal(validatePlay({ ...lead, hand: [j], trickNumber: 10, jokerLeadSuit: 'SPADE' }).valid, true);
  // following: joker may be played even while holding the lead suit
  assert.equal(validatePlay({ ...base, card: j, hand, leadSuit: 'SPADE', isLeading: false, trickNumber: 5 }).valid, true);
});

test('joker may be played (powerless) on the first and last trick when following', () => {
  const j = joker();
  const hand = [j, card('SPADE', '5')];
  for (const trickNumber of [1, 10]) {
    assert.equal(validatePlay({ ...base, card: j, hand, leadSuit: 'SPADE', isLeading: false, trickNumber }).valid, true);
  }
});

test('mighty is exempt from following suit and is not a lead-suit card that forces following', () => {
  const mighty = card('SPADE', 'A');
  const heart = card('HEART', '4');
  const club = card('CLUB', '7');
  const hand = [mighty, heart];
  const follow = { ...base, isLeading: false, trickNumber: 3 };
  // lead suit HEART, holds a heart: the mighty may still be played, as may the heart
  assert.equal(validatePlay({ ...follow, card: mighty, hand, leadSuit: 'HEART' }).valid, true);
  assert.equal(validatePlay({ ...follow, card: heart, hand, leadSuit: 'HEART' }).valid, true);
  // lead suit SPADE, the mighty is the only spade: no obligation to follow, any card is legal
  assert.equal(validatePlay({ ...follow, card: mighty, hand, leadSuit: 'SPADE' }).valid, true);
  assert.equal(validatePlay({ ...follow, card: heart, hand, leadSuit: 'SPADE' }).valid, true);
  // a non-mighty lead-suit card in hand still forces following for the other cards
  const withSpade = [mighty, card('SPADE', '5'), club];
  assert.equal(validatePlay({ ...follow, card: club, hand: withSpade, leadSuit: 'SPADE' }).reason, 'must_follow_lead_suit');
  // the joker does not count as a card of the lead suit
  assert.equal(validatePlay({ ...follow, card: heart, hand: [heart, joker()], leadSuit: 'SPADE' }).valid, true);
});

test('mighty follows the giruda: with SPADE giruda the mighty is DIAMOND A and SPADE A is ordinary', () => {
  const dA = card('DIAMOND', 'A');
  const sA = card('SPADE', 'A');
  const d5 = card('DIAMOND', '5');
  const follow = { ...base, giruda: 'SPADE', isLeading: false, trickNumber: 3 };
  // lead DIAMOND with a lower diamond in hand: the mighty (DIAMOND A) may be played anyway
  const hand = [dA, d5, sA];
  assert.equal(validatePlay({ ...follow, card: dA, hand, leadSuit: 'DIAMOND' }).valid, true);
  assert.equal(validatePlay({ ...follow, card: sA, hand, leadSuit: 'DIAMOND' }).reason, 'must_follow_lead_suit');
  // lead DIAMOND where DIAMOND A is the only diamond: no obligation to follow
  assert.equal(validatePlay({ ...follow, card: sA, hand: [dA, sA], leadSuit: 'DIAMOND' }).valid, true);
  // lead SPADE: SPADE A is not the mighty, so it is a normal lead-suit card and forces following
  const h = card('HEART', '2');
  assert.equal(validatePlay({ ...follow, card: h, hand: [sA, h], leadSuit: 'SPADE' }).reason, 'must_follow_lead_suit');
  assert.equal(validatePlay({ ...follow, card: dA, hand: [sA, dA], leadSuit: 'SPADE' }).valid, true);
});

test('joker call active: the joker-call card takes priority over the mighty', () => {
  const callCard = card('CLUB', '3');
  const mighty = card('SPADE', 'A');
  const d9 = card('DIAMOND', '9');
  const hand = [callCard, mighty, d9];
  const args = { ...base, hand, leadSuit: 'DIAMOND', isLeading: false, trickNumber: 3, isJokerCallActive: true };
  assert.equal(validatePlay({ ...args, card: mighty }).reason, 'must_play_joker_call_card');
  assert.equal(validatePlay({ ...args, card: d9 }).reason, 'must_play_joker_call_card');
  assert.equal(validatePlay({ ...args, card: callCard }).valid, true);
  // without the call card in hand the mighty is playable again
  const noCall = [mighty, d9];
  assert.equal(validatePlay({ ...args, hand: noCall, card: mighty }).valid, true);
});

test('isJokerPowerless: first trick, last trick, or joker call', () => {
  const a = { totalTricks: 10, isJokerCallActive: false };
  assert.equal(isJokerPowerless({ ...a, trickNumber: 1 }), true);
  assert.equal(isJokerPowerless({ ...a, trickNumber: 10 }), true);
  assert.equal(isJokerPowerless({ ...a, trickNumber: 5 }), false);
  assert.equal(isJokerPowerless({ ...a, trickNumber: 5, isJokerCallActive: true }), true);
});

test('trick winner: joker beats giruda, mighty beats joker, powerless joker loses to everything', () => {
  const mightyCard = getMightyCard('HEART');
  const plays = (cs: [string, Card][]) => cs.map(([playerId, c]) => ({ playerId, card: c }));
  const common = { leadSuit: 'SPADE', giruda: 'HEART', mightyCard };

  const w1 = determineTrickWinner({
    ...common,
    plays: plays([['a', card('SPADE', 'K')], ['b', card('HEART', '2')], ['c', joker()]]),
  });
  assert.equal(w1.winnerPlayerId, 'c');

  const w2 = determineTrickWinner({
    ...common,
    plays: plays([['a', card('SPADE', 'A')], ['b', joker()], ['c', card('SPADE', 'K')]]),
  });
  assert.equal(w2.winnerPlayerId, 'a', 'the mighty (SPADE A) beats the joker');

  // joker call: the joker is the weakest, even below an off-suit discard
  const w3 = determineTrickWinner({
    ...common,
    jokerPowerless: true,
    plays: plays([['a', card('SPADE', '2')], ['b', joker()], ['c', card('DIAMOND', 'K')]]),
  });
  assert.equal(w3.winnerPlayerId, 'a');

  // a powerless joker that is the only play still "wins" (nothing else to compare)
  const w4 = determineTrickWinner({ ...common, jokerPowerless: true, plays: plays([['a', joker()]]) });
  assert.equal(w4.winnerPlayerId, 'a');

  // mighty is SPADE A only when giruda is not SPADE
  assert.deepEqual(getMightyCard('SPADE'), { suit: 'DIAMOND', rank: 'A' });
});

// ---- Engine integration ----

function makePlayers(): Player[] {
  return Array.from({ length: 5 }, (_, i) => ({
    id: `p${i}`,
    socketId: '',
    username: `p${i}`,
    seat: (['bottom', 'left', 'top', 'center', 'right'] as const)[i],
    hand: [],
    isReady: false,
    isAi: i !== 0,
    collectedScoreCards: [],
    score: 0,
    isFriend: false,
    isOwner: false,
  }));
}

/** Kitty exchange (president p0 discards 3 cards) and a no-friend declaration. */
function exchangeAndDeclareNoFriend(engine: GameEngine): void {
  const president = engine.state.players.find((p) => p.id === 'p0')!;
  engine.exchangeKitty('p0', { discardCardIds: president.hand.slice(0, 3).map((c) => c.id) });
  engine.declareFriend('p0', { type: 'NO_FRIEND' });
}

/** An engine in TRICK_PLAYING (trick `trickNumber`) with hands set up by the test. */
function engineWith(giruda: string, hands: Card[][], trickNumber: number): GameEngine {
  const engine = new GameEngine({ players: makePlayers(), giruda: 'NO_GIRUDA' });
  engine.deal();
  engine.placeBid('p0', { score: 13, giruda });
  for (const id of ['p1', 'p2', 'p3', 'p4']) engine.placeBid(id, { pass: true });
  exchangeAndDeclareNoFriend(engine);
  engine.state.players.forEach((p, i) => (p.hand = hands[i]));
  engine.state.currentTrickNumber = trickNumber;
  (engine as unknown as { _trickNumber: number })._trickNumber = trickNumber;
  return engine;
}

test('engine: the call card is not forced on the holder in an ordinary trick (call not declared)', () => {
  const callCard = card('CLUB', '3');
  const d9 = card('DIAMOND', '9');
  const hands = [[card('DIAMOND', '5')], [d9, callCard], [card('DIAMOND', '6')], [card('DIAMOND', '7')], [card('DIAMOND', '8')]];
  const engine = engineWith('HEART', hands, 3);
  engine.playCard('p0', hands[0][0].id);
  // p1 holds the call card but nobody declared it: must follow diamonds instead.
  assert.throws(() => engine.playCard('p1', callCard.id), /must_follow_lead_suit/);
  assert.doesNotThrow(() => engine.playCard('p1', d9.id));
});

test('engine: declaring the joker call weakens the joker in that trick (state + winner)', () => {
  const callCard = card('CLUB', '3');
  const j = joker();
  const hands = [
    [callCard, card('HEART', '2')],
    [card('CLUB', '2'), card('CLUB', '4')],
    [j],
    [card('CLUB', '5')],
    [card('CLUB', '6')],
  ];
  const engine = engineWith('HEART', hands, 4);
  engine.playCard('p0', callCard.id, { jokerCall: true });
  assert.equal(engine.state.isJokerCallActive, true);
  engine.playCard('p1', hands[1][0].id);
  engine.playCard('p2', j.id);
  engine.playCard('p3', hands[3][0].id);
  const r = engine.playCard('p4', hands[4][0].id);
  assert.equal(r.trick?.winnerPlayerId, 'p4', 'club 6 wins; the powerless joker does not');
  assert.equal(engine.state.isJokerCallActive, true, 'still shown while the trick is resolved');
  engine.advanceAfterTrick();
  assert.equal(engine.state.isJokerCallActive, false, 'reset once the next trick starts');
});

test('engine: without a joker call the joker wins the trick', () => {
  const j = joker();
  const hands = [
    [card('CLUB', '3'), card('HEART', '2')],
    [card('CLUB', '2')],
    [j],
    [card('CLUB', '5')],
    [card('CLUB', 'K')],
  ];
  const engine = engineWith('HEART', hands, 4);
  engine.playCard('p0', hands[0][0].id);
  assert.equal(engine.state.isJokerCallActive, false);
  engine.playCard('p1', hands[1][0].id);
  engine.playCard('p2', j.id);
  engine.playCard('p3', hands[3][0].id);
  assert.equal(engine.playCard('p4', hands[4][0].id).trick?.winnerPlayerId, 'p2');
});

test('engine: a joker lead needs a suit, which the others must follow', () => {
  const j = joker();
  const s5 = card('SPADE', '5');
  const h4 = card('HEART', '4');
  const hands = [
    [j, card('CLUB', '2')],
    [s5, h4],
    [card('SPADE', '6')],
    [card('SPADE', '7')],
    [card('SPADE', '8')],
  ];
  const engine = engineWith('DIAMOND', hands, 4);
  assert.throws(() => engine.playCard('p0', j.id), /joker_lead_suit_required/);
  engine.playCard('p0', j.id, { jokerLeadSuit: 'SPADE' });
  assert.equal(engine.state.leadSuit, 'SPADE');
  assert.equal(engine.state.currentTrick?.leadSuit, 'SPADE');
  assert.throws(() => engine.playCard('p1', h4.id), /must_follow_lead_suit/);
  engine.playCard('p1', s5.id);
});

test('engine: the mighty is recomputed from the giruda (SPADE giruda -> DIAMOND A)', () => {
  const dA = card('DIAMOND', 'A');
  const hands = [
    [card('SPADE', 'A'), card('HEART', '2')],
    [dA],
    [card('SPADE', '2')],
    [card('SPADE', '3')],
    [card('SPADE', '4')],
  ];
  const engine = engineWith('SPADE', hands, 4);
  assert.deepEqual(engine.mightyCard, { suit: 'DIAMOND', rank: 'A' });
  engine.playCard('p0', hands[0][0].id);
  engine.playCard('p1', dA.id);
  engine.playCard('p2', hands[2][0].id);
  engine.playCard('p3', hands[3][0].id);
  // SPADE A is just the strongest giruda; the mighty DIAMOND A beats it.
  assert.equal(engine.playCard('p4', hands[4][0].id).trick?.winnerPlayerId, 'p1');
});

test('AI: legal in every trick, declares the joker call only when it leads with the call card', () => {
  const callCard = card('CLUB', '3');
  const hand = [callCard, card('HEART', '9'), card('HEART', '4')];
  const d = selectCardToPlay({
    hand,
    currentTrickPlays: [],
    giruda: 'SPADE',
    trickNumber: 4,
    totalTricks: 10,
    isPartnerWinningCurrentTrick: false,
    mightyCard: getMightyCard('SPADE'),
    jokerCallCard: getJokerCallCard('SPADE'),
  });
  assert.equal(d.jokerCall, true);
  assert.equal(d.cardId, callCard.id);

  // Following with the call card in hand but no call declared: ordinary follow-suit rules.
  const f = selectCardToPlay({
    hand,
    leadSuit: 'HEART',
    currentTrickPlays: [{ playerId: 'x', card: card('HEART', '2') }],
    giruda: 'SPADE',
    trickNumber: 4,
    totalTricks: 10,
    isPartnerWinningCurrentTrick: false,
    mightyCard: getMightyCard('SPADE'),
    jokerCallCard: getJokerCallCard('SPADE'),
  });
  assert.notEqual(f.cardId, callCard.id);
  assert.notEqual(f.jokerCall, true);
});

test('AI self-play: full games always finish with legal plays', () => {
  for (let g = 0; g < 100; g++) {
    const engine = new GameEngine({ players: makePlayers(), giruda: 'NO_GIRUDA' });
    engine.deal();
    engine.placeBid('p0', { score: 13, giruda: (['SPADE', 'CLUB', 'HEART', 'DIAMOND', 'NO_GIRUDA'] as const)[g % 5] });
    for (const id of ['p1', 'p2', 'p3', 'p4']) engine.placeBid(id, { pass: true });
    exchangeAndDeclareNoFriend(engine);

    let guard = 0;
    while (engine.state.phase === 'TRICK_PLAYING' || engine.state.phase === 'TRICK_RESOLVED') {
      assert.ok(guard++ < 100, 'game does not finish');
      if (engine.state.phase === 'TRICK_RESOLVED') {
        engine.advanceAfterTrick();
        continue;
      }
      const turn = engine.state.players[engine.state.currentTurnIndex];
      const plays = engine.state.currentTrick?.cards ?? [];
      const d = selectCardToPlay({
        hand: turn.hand,
        leadSuit: engine.state.currentTrick?.leadSuit,
        currentTrickPlays: plays,
        giruda: engine.state.giruda,
        trickNumber: engine.state.currentTrickNumber,
        totalTricks: TOTAL_TRICKS,
        isPartnerWinningCurrentTrick: false,
        mightyCard: engine.mightyCard,
        jokerCallCard: engine.jokerCallCard,
        restrictGirudaLead: engine.restrictsGirudaLead(),
        isJokerCallActive: engine.state.isJokerCallActive,
      });
      engine.playCard(turn.id, d.cardId, { jokerCall: d.jokerCall, jokerLeadSuit: d.jokerLeadSuit });
    }
    assert.equal(engine.state.phase, 'GAME_OVER');
  }
});
