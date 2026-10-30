import assert from 'node:assert/strict';
import { validateBid, bidRank, lowestValidScore } from './bidding';
import { GameEngine } from './game-engine';
import { selectBid } from './ai';
import { getMightyCard, getJokerCallCard } from './rules';
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
    // p0 is the room host; the president must not depend on this flag.
    isOwner: i === 0,
  }));
}

function newEngine(): GameEngine {
  const engine = new GameEngine({ players: makePlayers(), giruda: 'NO_GIRUDA' });
  engine.deal();
  return engine;
}

const bid = (score: number, giruda: string) => ({ score, giruda });

test('validateBid: range, giruda required, and strictly higher than current', () => {
  assert.equal(validateBid({ isPass: true }).valid, true);
  assert.equal(validateBid({ giruda: 'SPADE' }).reason, 'bid_required');
  assert.equal(validateBid({ score: 12, giruda: 'SPADE' }).reason, 'bid_below_minimum');
  assert.equal(validateBid({ score: 21, giruda: 'SPADE' }).reason, 'bid_above_maximum');
  assert.equal(validateBid({ score: 13.5, giruda: 'SPADE' }).reason, 'bid_must_be_integer');
  assert.equal(validateBid({ score: 13 }).reason, 'giruda_required');
  assert.equal(validateBid({ score: 13, giruda: 'STAR' }).reason, 'invalid_giruda');
  assert.equal(validateBid({ score: 13, giruda: 'SPADE' }).valid, true);
  assert.equal(validateBid({ score: 20, giruda: 'NO_GIRUDA' }).valid, true);

  const current = { bidderIndex: 0, score: 15, giruda: 'HEART' as const };
  assert.equal(validateBid({ score: 15, giruda: 'SPADE', currentBid: current }).reason, 'bid_must_exceed_current');
  assert.equal(validateBid({ score: 14, giruda: 'NO_GIRUDA', currentBid: current }).reason, 'bid_must_exceed_current');
  assert.equal(validateBid({ score: 16, giruda: 'SPADE', currentBid: current }).valid, true);
});

test('validateBid: at equal score, no-giruda outranks a suit but not vice versa', () => {
  assert.ok(bidRank(15, 'NO_GIRUDA') > bidRank(15, 'SPADE'));
  assert.ok(bidRank(16, 'SPADE') > bidRank(15, 'NO_GIRUDA'));
  const suit = { bidderIndex: 0, score: 15, giruda: 'SPADE' as const };
  assert.equal(validateBid({ score: 15, giruda: 'NO_GIRUDA', currentBid: suit }).valid, true);
  const noGiruda = { bidderIndex: 0, score: 15, giruda: 'NO_GIRUDA' as const };
  assert.equal(validateBid({ score: 15, giruda: 'SPADE', currentBid: noGiruda }).valid, false);
  assert.equal(lowestValidScore('SPADE', noGiruda), 16);
  assert.equal(lowestValidScore('NO_GIRUDA', suit), 15);
  assert.equal(lowestValidScore('SPADE', { bidderIndex: 0, score: 20, giruda: 'NO_GIRUDA' }), null);
});

test('bidding skips passed players and ends when one bidder remains', () => {
  const engine = newEngine();
  assert.equal(engine.state.phase, 'BIDDING');
  assert.equal(engine.state.currentTurnIndex, 0);

  engine.placeBid('p0', { score: 13, giruda: 'SPADE' });
  engine.placeBid('p1', { pass: true });
  engine.placeBid('p2', { score: 14, giruda: 'HEART' });
  engine.placeBid('p3', { pass: true });
  engine.placeBid('p4', { pass: true });
  // p1, p3, p4 have passed; p0 and p2 are left, p0 is next.
  assert.equal(engine.state.currentTurnIndex, 0);
  assert.equal(engine.state.passCount, 3);

  const r = engine.placeBid('p0', { score: 15, giruda: 'CLUB' });
  assert.equal(r.completed, false);
  // p1 passed, so the turn skips to p2.
  assert.equal(engine.state.currentTurnIndex, 2);

  const end = engine.placeBid('p2', { pass: true });
  assert.equal(end.completed, true);
  assert.equal(engine.state.phase, 'KITTY_EXCHANGE');
  assert.equal(engine.state.presidentIndex, 0);
  assert.equal(engine.state.currentBid, 15);
});

test('a passed player cannot bid again', () => {
  const engine = newEngine();
  engine.placeBid('p0', { score: 13, giruda: 'SPADE' });
  engine.placeBid('p1', { pass: true });
  engine.placeBid('p2', { pass: true });
  engine.placeBid('p3', { score: 14, giruda: 'SPADE' });
  engine.placeBid('p4', { pass: true });
  // Only p0 and p3 remain; p1 / p2 are never given the turn again.
  assert.equal(engine.state.currentTurnIndex, 0);
  assert.throws(() => engine.placeBid('p1', { score: 20, giruda: 'SPADE' }), /Not this player turn/);
  engine.placeBid('p0', { pass: true });
  assert.equal(engine.state.phase, 'KITTY_EXCHANGE');
  assert.equal(engine.state.presidentIndex, 3);
});

test('bids are validated by the engine and do not change state on error', () => {
  const engine = newEngine();
  assert.throws(() => engine.placeBid('p0', { score: 13 }), /giruda_required/);
  assert.throws(() => engine.placeBid('p0', { score: 21, giruda: 'SPADE' }), /bid_above_maximum/);
  assert.throws(() => engine.placeBid('p1', { score: 13, giruda: 'SPADE' }), /Not this player turn/);
  assert.equal(engine.state.currentBid, 0);
  assert.equal(engine.state.currentTurnIndex, 0);
  engine.placeBid('p0', { score: 13, giruda: 'SPADE' });
  assert.throws(() => engine.placeBid('p1', { score: 13, giruda: 'HEART' }), /bid_must_exceed_current/);
});

test('the president is the bid winner, not the room host', () => {
  const engine = newEngine();
  engine.placeBid('p0', { pass: true });
  engine.placeBid('p1', { pass: true });
  engine.placeBid('p2', { score: 16, giruda: 'DIAMOND' });
  engine.placeBid('p3', { pass: true });
  const r = engine.placeBid('p4', { pass: true });

  assert.equal(r.completed, true);
  assert.equal(engine.state.phase, 'KITTY_EXCHANGE');
  assert.equal(engine.state.presidentIndex, 2);
  assert.equal(engine.state.ownerPlayerId, 'p2');
  assert.deepEqual(
    engine.state.players.map((p) => p.isOwner),
    [false, false, true, false, false]
  );
  assert.equal(engine.state.currentTurnIndex, 2);
});

test('mighty and joker-call cards are recomputed from the winning giruda', () => {
  const engine = newEngine();
  // Before bidding: no-giruda defaults.
  assert.deepEqual(engine.mightyCard, getMightyCard('NO_GIRUDA'));

  engine.placeBid('p0', { score: 14, giruda: 'SPADE' });
  engine.placeBid('p1', { pass: true });
  engine.placeBid('p2', { pass: true });
  engine.placeBid('p3', { pass: true });
  engine.placeBid('p4', { pass: true });

  assert.equal(engine.state.giruda, 'SPADE');
  assert.deepEqual(engine.mightyCard, { suit: 'DIAMOND', rank: 'A' });
  assert.deepEqual(engine.jokerCallCard, getJokerCallCard('SPADE'));

  const clubEngine = newEngine();
  clubEngine.placeBid('p0', { score: 14, giruda: 'CLUB' });
  for (const id of ['p1', 'p2', 'p3', 'p4']) clubEngine.placeBid(id, { pass: true });
  assert.deepEqual(clubEngine.jokerCallCard, { suit: 'SPADE', rank: '3' });
  assert.deepEqual(clubEngine.mightyCard, { suit: 'SPADE', rank: 'A' });
});

test('a 20 no-giruda bid ends bidding immediately (nobody can outbid)', () => {
  const engine = newEngine();
  const r = engine.placeBid('p0', { score: 20, giruda: 'NO_GIRUDA' });
  assert.equal(r.completed, true);
  assert.equal(engine.state.phase, 'KITTY_EXCHANGE');
  assert.equal(engine.state.giruda, 'NO_GIRUDA');
});

test('everybody passing re-deals: new hands, fresh bidding state', () => {
  const engine = newEngine();
  const before = engine.state.players[0].hand.map((c) => c.id).join(',');
  for (const id of ['p0', 'p1', 'p2', 'p3']) {
    assert.equal(engine.placeBid(id, { pass: true }).redealt, false);
  }
  const r = engine.placeBid('p4', { pass: true });

  assert.equal(r.redealt, true);
  assert.equal(r.completed, false);
  assert.equal(engine.state.phase, 'BIDDING');
  assert.equal(engine.state.passCount, 0);
  assert.equal(engine.state.currentBid, 0);
  assert.equal(engine.state.highestBid, null);
  assert.equal(engine.state.presidentIndex, null);
  assert.equal(engine.state.currentTurnIndex, 0);
  assert.ok(engine.state.players.every((p) => !p.hasPassed && p.hand.length === 10));
  assert.equal(engine.state.kitty.length, 3);
  // Astronomically unlikely to match unless the deal was not repeated.
  assert.notEqual(engine.state.players[0].hand.map((c) => c.id).join(','), before);
  // Players can bid again after the re-deal.
  engine.placeBid('p0', { score: 13, giruda: 'HEART' });
});

test('the human (p0) always bids first and the first bidder does not rotate after a re-deal', () => {
  const engine = newEngine();
  assert.equal(engine.state.currentTurnIndex, 0);
  for (const id of ['p0', 'p1', 'p2', 'p3', 'p4']) engine.placeBid(id, { pass: true });
  assert.equal(engine.state.currentTurnIndex, 0);
});

test('when the first four pass, the last seat may still bid and becomes president', () => {
  const engine = newEngine();
  for (const id of ['p0', 'p1', 'p2', 'p3']) engine.placeBid(id, { pass: true });
  assert.equal(engine.state.currentTurnIndex, 4);
  const r = engine.placeBid('p4', { score: 13, giruda: 'CLUB' });
  assert.equal(r.completed, true);
  assert.equal(r.redealt, false);
  assert.equal(engine.state.ownerPlayerId, 'p4');
  assert.equal(engine.state.phase, 'KITTY_EXCHANGE');
});

test('AI bids always carry a giruda and are accepted by the engine', () => {
  for (let i = 0; i < 50; i++) {
    const engine = newEngine();
    let guard = 0;
    while (engine.state.phase === 'BIDDING' && guard++ < 100) {
      const turn = engine.state.players[engine.state.currentTurnIndex];
      const d = selectBid({ hand: turn.hand, currentBid: engine.state.highestBid });
      if (d.bid === null) {
        assert.equal(d.giruda, null);
      } else {
        assert.ok(d.giruda);
      }
      engine.placeBid(turn.id, { pass: d.bid === null, score: d.bid ?? undefined, giruda: d.giruda ?? undefined });
    }
    assert.ok(guard < 100);
  }
});
