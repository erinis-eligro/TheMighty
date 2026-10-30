import assert from 'node:assert/strict';
import { GameEngine } from './game-engine';
import { validatePlay } from './trick';
import { Card, Player } from '../entities/game.entity';

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

const card = (suit: Card['suit'], rank: Card['rank']): Card => ({
  suit,
  rank,
  isJoker: suit === 'JOKER',
  id: `${suit}_${rank}`,
});

/**
 * p2 is president (giruda HEART) and the engine is in TRICK_PLAYING for trick 1.
 * Hands are replaced with deterministic ones: every player holds 10 cards.
 */
function playingEngine(declaration: Parameters<GameEngine['declareFriend']>[1] = { type: 'NO_FRIEND' }): GameEngine {
  const engine = new GameEngine({ players: makePlayers(), giruda: 'NO_GIRUDA' });
  engine.deal();
  engine.placeBid('p0', { pass: true });
  engine.placeBid('p1', { pass: true });
  engine.placeBid('p2', { score: 13, giruda: 'HEART' });
  engine.placeBid('p3', { pass: true });
  engine.placeBid('p4', { pass: true });
  const ids = [...engine.state.players[2].hand, ...engine.state.kitty].slice(0, 3).map((c) => c.id);
  engine.exchangeKitty('p2', { discardCardIds: ids });
  engine.declareFriend('p2', declaration);
  return engine;
}

function setHands(engine: GameEngine, hands: Card[][]) {
  hands.forEach((h, i) => (engine.state.players[i].hand = h));
}

test('5th card moves to TRICK_RESOLVED and keeps the completed trick visible', () => {
  const engine = playingEngine();
  setHands(engine, [
    [card('CLUB', '5'), card('CLUB', '9')],
    [card('CLUB', 'K'), card('CLUB', '8')],
    [card('CLUB', '4'), card('CLUB', '2')],
    [card('CLUB', '10'), card('CLUB', '7')],
    [card('CLUB', 'A'), card('CLUB', '6')],
  ]);
  assert.equal(engine.state.currentTurnIndex, 2);

  engine.playCard('p2', 'CLUB_4');
  engine.playCard('p3', 'CLUB_10');
  engine.playCard('p4', 'CLUB_A');
  engine.playCard('p0', 'CLUB_5');
  const r = engine.playCard('p1', 'CLUB_K');

  assert.equal(r.trickComplete, true);
  assert.equal(engine.state.phase, 'TRICK_RESOLVED');
  assert.equal(engine.state.currentTrick?.cards.length, 5);
  assert.equal(engine.state.trickHistory.length, 1);
  assert.equal(engine.state.currentTrickNumber, 1);
  assert.equal(r.trick?.winnerPlayerId, 'p4');
  // Cards cannot be played while the trick is being shown.
  assert.throws(() => engine.playCard('p4', 'CLUB_6'), /Not in playing phase/);
});

test('winner collects the point card objects and leads the next trick after advanceAfterTrick', () => {
  const engine = playingEngine();
  setHands(engine, [
    [card('CLUB', '5'), card('CLUB', '9')],
    [card('CLUB', 'K'), card('CLUB', '8')],
    [card('CLUB', '4'), card('CLUB', '2')],
    [card('CLUB', '10'), card('CLUB', '7')],
    [card('CLUB', 'A'), card('CLUB', '6')],
  ]);
  engine.playCard('p2', 'CLUB_4');
  engine.playCard('p3', 'CLUB_10');
  engine.playCard('p4', 'CLUB_A');
  engine.playCard('p0', 'CLUB_5');
  engine.playCard('p1', 'CLUB_K');

  const winner = engine.state.players[4];
  assert.deepEqual(winner.collectedScoreCards.map((c) => c.id).sort(), ['CLUB_10', 'CLUB_A', 'CLUB_K']);
  assert.equal(winner.score, 3);

  const r = engine.advanceAfterTrick();
  assert.equal(r.gameOver, false);
  assert.equal(engine.state.phase, 'TRICK_PLAYING');
  assert.equal(engine.state.currentTrick, null);
  assert.equal(engine.state.leadSuit, null);
  assert.equal(engine.state.currentTrickNumber, 2);
  assert.equal(engine.state.currentTurnIndex, 4);
  assert.throws(() => engine.advanceAfterTrick(), /Not in trick resolved phase/);
});

test('leadSuit and trick fields are set while a trick is in progress', () => {
  const engine = playingEngine();
  setHands(engine, [
    [card('CLUB', '5')],
    [card('CLUB', 'K')],
    [card('SPADE', '4')],
    [card('CLUB', '10')],
    [card('CLUB', 'A')],
  ]);
  assert.equal(engine.state.currentTrickNumber, 1);
  assert.equal(engine.state.leadSuit, null);
  engine.playCard('p2', 'SPADE_4');
  assert.equal(engine.state.leadSuit, 'SPADE');
  assert.equal(engine.state.currentTrick?.trickNumber, 1);
});

test('after the last trick advanceAfterTrick goes ROUND_SCORING -> GAME_OVER', () => {
  const engine = playingEngine();
  // Fast-forward to the last trick with one card each.
  (engine as unknown as { _trickNumber: number })._trickNumber = 10;
  engine.state.currentTrickNumber = 10;
  setHands(engine, [
    [card('CLUB', '5')],
    [card('CLUB', 'K')],
    [card('CLUB', '4')],
    [card('CLUB', '10')],
    [card('CLUB', 'A')],
  ]);
  engine.playCard('p2', 'CLUB_4');
  engine.playCard('p3', 'CLUB_10');
  engine.playCard('p4', 'CLUB_A');
  engine.playCard('p0', 'CLUB_5');
  engine.playCard('p1', 'CLUB_K');
  assert.equal(engine.state.phase, 'TRICK_RESOLVED');
  assert.throws(() => engine.getResult(), /Game has not ended/);

  assert.equal(engine.advanceAfterTrick().gameOver, true);
  assert.equal(engine.state.phase, 'GAME_OVER');
  assert.equal(engine.getResult().teamPoints, 0);
});

test('last trick: a joker lead must name a suit, and the highest card of that suit wins', () => {
  const engine = playingEngine();
  (engine as unknown as { _trickNumber: number })._trickNumber = 10;
  engine.state.currentTrickNumber = 10;
  setHands(engine, [
    [card('CLUB', 'K')],
    [card('CLUB', '4')],
    [card('JOKER', '2')],
    [card('CLUB', '10')],
    [card('CLUB', 'A')],
  ]);
  assert.throws(() => engine.playCard('p2', 'JOKER_2'), /joker_lead_suit_required/);
  assert.equal(engine.state.players[2].hand.length, 1);
  assert.deepEqual(engine.getPlayableCardIds('p2'), ['JOKER_2']);

  engine.playCard('p2', 'JOKER_2', { jokerLeadSuit: 'CLUB' });
  engine.playCard('p3', 'CLUB_10');
  engine.playCard('p4', 'CLUB_A');
  engine.playCard('p0', 'CLUB_K');
  engine.playCard('p1', 'CLUB_4');
  assert.equal(engine.state.trickHistory[0].winnerPlayerId, 'p4');
});

test('first-trick friend: the first trick winner becomes the friend', () => {
  const engine = playingEngine({ type: 'FIRST_TRICK' });
  setHands(engine, [
    [card('CLUB', '5')],
    [card('CLUB', 'K')],
    [card('CLUB', '4')],
    [card('CLUB', '10')],
    [card('CLUB', 'A')],
  ]);
  assert.equal(engine.state.friendPlayerId, undefined);
  engine.playCard('p2', 'CLUB_4');
  engine.playCard('p3', 'CLUB_10');
  engine.playCard('p4', 'CLUB_A');
  engine.playCard('p0', 'CLUB_5');
  engine.playCard('p1', 'CLUB_K');

  assert.equal(engine.state.friendPlayerId, 'p4');
  assert.equal(engine.state.friendIndex, 4);
  assert.equal(engine.state.players[4].isFriend, true);
  assert.equal(engine.state.players.filter((p) => p.isFriend).length, 1);
});

test('first-trick friend: president winning the first trick means no friend', () => {
  const engine = playingEngine({ type: 'FIRST_TRICK' });
  setHands(engine, [
    [card('CLUB', '5')],
    [card('CLUB', 'K')],
    [card('SPADE', 'A')],
    [card('CLUB', '10')],
    [card('CLUB', '3')],
  ]);
  engine.playCard('p2', 'SPADE_A');
  engine.playCard('p3', 'CLUB_10');
  engine.playCard('p4', 'CLUB_3');
  engine.playCard('p0', 'CLUB_5');
  engine.playCard('p1', 'CLUB_K');
  assert.equal(engine.state.trickHistory[0].winnerPlayerId, 'p2');
  assert.equal(engine.state.friendPlayerId, undefined);
  assert.equal(engine.state.players.some((p) => p.isFriend), false);
});

test('first trick: the president cannot lead the giruda while holding other cards', () => {
  const engine = playingEngine();
  setHands(engine, [[], [], [card('HEART', 'A'), card('CLUB', '4')], [], []]);
  assert.equal(engine.restrictsGirudaLead(), true);
  assert.throws(() => engine.playCard('p2', 'HEART_A'), /cannot_lead_giruda_on_first_trick/);
  assert.equal(engine.state.players[2].hand.length, 2);
  engine.playCard('p2', 'CLUB_4');
  assert.equal(engine.restrictsGirudaLead(), false);
});

test('first trick: the president may lead the giruda if holding nothing else', () => {
  const engine = playingEngine();
  setHands(engine, [[], [], [card('HEART', 'A'), card('HEART', '4')], [], []]);
  engine.playCard('p2', 'HEART_A');
  assert.equal(engine.state.leadSuit, 'HEART');
});

test('giruda lead restriction only applies to the president leading, not to followers or later tricks', () => {
  const base = {
    card: card('HEART', 'A'),
    hand: [card('HEART', 'A'), card('CLUB', '4')],
    trickNumber: 1,
    totalTricks: 10,
    giruda: 'HEART',
  };
  assert.equal(validatePlay({ ...base, restrictGirudaLead: true }).valid, false);
  assert.equal(validatePlay({ ...base, restrictGirudaLead: false }).valid, true);
  // Following a lead (leadSuit set) is never a "lead".
  assert.equal(validatePlay({ ...base, leadSuit: 'HEART', restrictGirudaLead: true }).valid, true);
});

test('giruda lead restriction does not apply to no-giruda games', () => {
  const base = {
    card: card('HEART', 'A'),
    hand: [card('HEART', 'A'), card('CLUB', '4')],
    trickNumber: 1,
    totalTricks: 10,
    giruda: 'NO_GIRUDA',
    restrictGirudaLead: true,
  };
  assert.equal(validatePlay(base).valid, true);
});
