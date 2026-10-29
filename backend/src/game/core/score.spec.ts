import assert from 'node:assert/strict';
import { scoreRound, getPlayerRole, evaluateGameResult } from './score';
import { GameEngine } from './game-engine';
import { selectCardToPlay } from './ai';
import { TOTAL_TRICKS } from './rules';
import { Player } from '../entities/game.entity';

const cards = (n: number) => Array.from({ length: n }, () => ({}));

function players(points: number[]) {
  return points.map((n, i) => ({ id: `p${i}`, collectedScoreCards: cards(n) }));
}

test('getPlayerRole distinguishes owner, friend and opposition', () => {
  assert.equal(getPlayerRole('p0', 'p0', 'p1'), 'OWNER');
  assert.equal(getPlayerRole('p1', 'p0', 'p1'), 'FRIEND');
  assert.equal(getPlayerRole('p2', 'p0', 'p1'), 'OPPOSER');
  assert.equal(getPlayerRole('p2', 'p0', undefined), 'OPPOSER');
});

test('scoreRound sums owner + friend points against the opposition', () => {
  const r = scoreRound({
    players: players([6, 4, 3, 5, 2]),
    ownerPlayerId: 'p0',
    friendPlayerId: 'p1',
    bidScore: 10,
    giruda: 'HEART',
  });
  assert.equal(r.teamPoints, 10);
  assert.equal(r.opponentPoints, 10);
  assert.equal(r.isWin, true);
  assert.equal(r.friendPlayerId, 'p1');
  assert.deepEqual(r.players.map((p) => p.role), ['OWNER', 'FRIEND', 'OPPOSER', 'OPPOSER', 'OPPOSER']);
});

test('scoreRound: owner loses when team points are below the bid', () => {
  const r = scoreRound({
    players: players([6, 3, 3, 5, 3]),
    ownerPlayerId: 'p0',
    friendPlayerId: 'p1',
    bidScore: 13,
    giruda: 'SPADE',
  });
  assert.equal(r.teamPoints, 9);
  assert.equal(r.isWin, false);
});

test('scoreRound: no friend -> owner alone counts as the team', () => {
  const r = scoreRound({
    players: players([14, 1, 1, 2, 2]),
    ownerPlayerId: 'p0',
    friendPlayerId: undefined,
    bidScore: 13,
    giruda: 'NO_GIRUDA',
  });
  assert.equal(r.teamPoints, 14);
  assert.equal(r.friendPlayerId, null);
  assert.equal(r.isWin, true);
});

test('scoreRound: president who is his own friend is not double counted', () => {
  const r = scoreRound({
    players: players([8, 4, 4, 2, 2]),
    ownerPlayerId: 'p0',
    friendPlayerId: 'p0',
    bidScore: 13,
    giruda: 'CLUB',
  });
  assert.equal(r.teamPoints, 8);
  assert.equal(r.friendPlayerId, null);
  assert.equal(r.players[0].role, 'OWNER');
});

test('evaluateGameResult: win at exactly the bid score', () => {
  assert.equal(evaluateGameResult(13, 13), true);
  assert.equal(evaluateGameResult(12, 13), false);
});

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

test('engine: getResult throws before the game is over', () => {
  const engine = new GameEngine({ players: makePlayers(), giruda: 'NO_GIRUDA' });
  assert.throws(() => engine.getResult());
});

/** Plays one full game (10 tricks) with the AI card selection and no friend. */
function playFullGame(): GameEngine {
  const engine = new GameEngine({ players: makePlayers(), giruda: 'NO_GIRUDA' });
  engine.deal();
  engine.placeBid('p0', { score: 13, giruda: 'HEART' });
  for (const id of ['p1', 'p2', 'p3', 'p4']) engine.placeBid(id, { pass: true });
  const p0 = engine.state.players[0];
  engine.exchangeKitty('p0', { discardCardIds: [...p0.hand, ...engine.state.kitty].slice(0, 3).map((c) => c.id) });
  engine.declareFriend('p0', { type: 'NO_FRIEND' });

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
  return engine;
}

test('engine: a full game ends in GAME_OVER with a scored result', () => {
  const engine = playFullGame();

  assert.equal(engine.state.phase, 'GAME_OVER');
  const r = engine.getResult();
  const collected = engine.state.players.reduce((s, p) => s + p.collectedScoreCards.length, 0);
  assert.equal(r.teamPoints + r.opponentPoints, collected);
  assert.equal(r.teamPoints, engine.state.players[0].collectedScoreCards.length);
  assert.equal(r.isWin, r.teamPoints >= 13);
  assert.deepEqual(engine.state.result, r);
});
