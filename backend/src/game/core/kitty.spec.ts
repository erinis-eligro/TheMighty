import assert from 'node:assert/strict';
import { GameEngine } from './game-engine';
import { selectCardToPlay, selectKittyDiscard } from './ai';
import { GIRUDA_CHANGE_RAISE, TOTAL_TRICKS, isPointCard } from './rules';
import { Player } from '../entities/game.entity';

function makePlayers(): Player[] {
  return Array.from({ length: 5 }, (_, i) => ({
    id: `p${i}`,
    socketId: '',
    username: `p${i}`,
    seat: (['bottom', 'top', 'left', 'right', 'center'] as const)[i],
    hand: [],
    isReady: false,
    isAi: i !== 0,
    collectedScoreCards: [],
    score: 0,
    isFriend: false,
    isOwner: false,
  }));
}

/** p2 wins the bidding with 15 HEART and the engine waits in KITTY_EXCHANGE. */
function kittyEngine(): GameEngine {
  const engine = new GameEngine({ players: makePlayers(), giruda: 'NO_GIRUDA' });
  engine.deal();
  engine.placeBid('p0', { pass: true });
  engine.placeBid('p1', { pass: true });
  engine.placeBid('p2', { score: 15, giruda: 'HEART' });
  engine.placeBid('p3', { pass: true });
  engine.placeBid('p4', { pass: true });
  assert.equal(engine.state.phase, 'KITTY_EXCHANGE');
  return engine;
}

function pick(engine: GameEngine, n = 3): string[] {
  return [...engine.state.players[2].hand, ...engine.state.kitty].slice(0, n).map((c) => c.id);
}

test('president absorbs the kitty, discards 3 and moves to FRIEND_SELECTION', () => {
  const engine = kittyEngine();
  const before = [...engine.state.players[2].hand, ...engine.state.kitty].map((c) => c.id).sort();
  const ids = [engine.state.kitty[0].id, engine.state.players[2].hand[0].id, engine.state.players[2].hand[1].id];

  const r = engine.exchangeKitty('p2', { discardCardIds: ids });

  assert.equal(engine.state.phase, 'FRIEND_SELECTION');
  const hand = engine.state.players[2].hand;
  assert.equal(hand.length, 10);
  assert.ok(ids.every((id) => !hand.some((c) => c.id === id)));
  assert.deepEqual(engine.state.kitty.map((c) => c.id).sort(), [...ids].sort());
  assert.deepEqual([...hand, ...engine.state.kitty].map((c) => c.id).sort(), before);
  assert.equal(r.giruda, 'HEART');
  assert.equal(r.bidScore, 15);
});

test('rejects wrong discard counts, duplicates and cards not owned', () => {
  const engine = kittyEngine();
  const ids = pick(engine);
  assert.throws(() => engine.exchangeKitty('p2', { discardCardIds: ids.slice(0, 2) }), /must_discard_exactly_3/);
  assert.throws(() => engine.exchangeKitty('p2', { discardCardIds: [...ids, pick(engine, 4)[3]] }), /must_discard_exactly_3/);
  assert.throws(() => engine.exchangeKitty('p2', { discardCardIds: [ids[0], ids[0], ids[1]] }), /duplicate_discard/);
  const other = engine.state.players[0].hand[0].id;
  assert.throws(() => engine.exchangeKitty('p2', { discardCardIds: [ids[0], ids[1], other] }), /discard_not_in_hand/);
  // Nothing changed after the rejections.
  assert.equal(engine.state.phase, 'KITTY_EXCHANGE');
  assert.equal(engine.state.players[2].hand.length, 10);
  assert.equal(engine.state.kitty.length, 3);
});

test('only the president can exchange, and only in KITTY_EXCHANGE', () => {
  const engine = kittyEngine();
  assert.throws(() => engine.exchangeKitty('p0', { discardCardIds: pick(engine) }), /Only the president/);
  assert.throws(() => engine.exchangeKitty('nobody', { discardCardIds: pick(engine) }), /Player not found/);
  engine.exchangeKitty('p2', { discardCardIds: pick(engine) });
  assert.throws(() => engine.exchangeKitty('p2', { discardCardIds: pick(engine) }), /Not in kitty exchange phase/);

  const bidding = new GameEngine({ players: makePlayers(), giruda: 'NO_GIRUDA' });
  bidding.deal();
  assert.throws(() => bidding.exchangeKitty('p0', { discardCardIds: [] }), /Not in kitty exchange phase/);
});

test('keeping the giruda leaves bid and giruda untouched', () => {
  const engine = kittyEngine();
  engine.exchangeKitty('p2', { discardCardIds: pick(engine), giruda: 'HEART', bidScore: 15 });
  assert.equal(engine.state.giruda, 'HEART');
  assert.equal(engine.state.currentBid, 15);

  const other = kittyEngine();
  assert.throws(
    () => other.exchangeKitty('p2', { discardCardIds: pick(other), bidScore: 17 }),
    /bid_raise_requires_giruda_change/
  );
});

test('changing the giruda requires raising the bid by at least 2 and recomputes mighty / joker call', () => {
  const engine = kittyEngine();
  const ids = pick(engine);
  assert.throws(() => engine.exchangeKitty('p2', { discardCardIds: ids, giruda: 'SPADE' }), /bid_raise_required/);
  assert.throws(
    () => engine.exchangeKitty('p2', { discardCardIds: ids, giruda: 'SPADE', bidScore: 15 + GIRUDA_CHANGE_RAISE - 1 }),
    /bid_raise_too_small/
  );
  assert.throws(
    () => engine.exchangeKitty('p2', { discardCardIds: ids, giruda: 'SPADE', bidScore: 21 }),
    /bid_above_maximum/
  );
  assert.throws(() => engine.exchangeKitty('p2', { discardCardIds: ids, giruda: 'STAR', bidScore: 17 }), /invalid_giruda/);
  assert.equal(engine.state.phase, 'KITTY_EXCHANGE');

  const r = engine.exchangeKitty('p2', { discardCardIds: ids, giruda: 'SPADE', bidScore: 17 });
  assert.equal(r.bidScore, 17);
  assert.equal(engine.state.giruda, 'SPADE');
  assert.equal(engine.state.currentBid, 17);
  assert.equal(engine.state.highestBid?.score, 17);
  assert.deepEqual(engine.mightyCard, { suit: 'DIAMOND', rank: 'A' });
});

test('discarded point cards do not count for either team', () => {
  const engine = kittyEngine();
  engine.exchangeKitty('p2', { discardCardIds: pick(engine) });
  assert.ok(engine.state.players.every((p) => p.collectedScoreCards.length === 0 && p.score === 0));
  engine.declareFriend('p2', { type: 'NO_FRIEND' });
  assert.equal(engine.state.phase, 'TRICK_PLAYING');
});

test('AI discard picks 3 valid cards and keeps joker, mighty and giruda-strength', () => {
  for (let i = 0; i < 30; i++) {
    const engine = kittyEngine();
    const president = engine.state.players[2];
    const cards = [...president.hand, ...engine.state.kitty];
    const { discardCardIds } = selectKittyDiscard({ cards, giruda: engine.state.giruda as string });
    assert.equal(new Set(discardCardIds).size, 3);
    for (const id of discardCardIds) {
      const c = cards.find((x) => x.id === id)!;
      assert.ok(!c.isJoker && !(c.suit === 'SPADE' && c.rank === 'A'));
    }
    engine.exchangeKitty('p2', { discardCardIds });
    assert.equal(engine.state.phase, 'FRIEND_SELECTION');
  }
});

test('discarded point cards leave the game: the reachable maximum is 20 minus the discarded point cards', () => {
  const engine = kittyEngine();
  const combined = [...engine.state.players[2].hand, ...engine.state.kitty];
  // Discard as many point cards as possible (up to 3), filling up with other cards.
  const sorted = [...combined].sort((a, b) => Number(isPointCard(b)) - Number(isPointCard(a)));
  const discard = sorted.slice(0, 3);
  const discardedPoints = discard.filter((c) => isPointCard(c)).length;
  engine.exchangeKitty('p2', { discardCardIds: discard.map((c) => c.id) });
  engine.declareFriend('p2', { type: 'NO_FRIEND' });

  while (['TRICK_PLAYING', 'TRICK_RESOLVED'].includes(engine.state.phase)) {
    if (engine.state.phase === 'TRICK_RESOLVED') {
      engine.advanceAfterTrick();
      continue;
    }
    const turn = engine.state.players[engine.state.currentTurnIndex];
    const d = selectCardToPlay({
      hand: turn.hand,
      leadSuit: engine.state.currentTrick?.leadSuit,
      currentTrickPlays: engine.state.currentTrick?.cards ?? [],
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

  const r = engine.getResult();
  assert.equal(r.teamPoints + r.opponentPoints, 20 - discardedPoints);
});
