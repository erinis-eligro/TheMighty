import assert from 'node:assert/strict';
import { GameEngine } from './game-engine';
import type { BidGiruda, Card, Player } from '../entities/game.entity';

const card = (suit: string, rank: string): Card =>
  ({ id: `${suit}_${rank}`, suit, rank, isJoker: suit === 'JOKER' }) as unknown as Card;

function makeEngine(giruda: BidGiruda = 'SPADE') {
  const players = Array.from({ length: 5 }, (_, i) => ({
    id: `p${i}`,
    socketId: '',
    username: `p${i}`,
    seat: 'bottom',
    hand: [],
    isReady: false,
    isAi: false,
    collectedScoreCards: [],
    score: 0,
    isFriend: false,
    isOwner: false,
  })) as unknown as Player[];
  const engine = new GameEngine({ players, giruda });
  engine.state.phase = 'TRICK_PLAYING';
  engine.state.giruda = giruda;
  engine.state.presidentIndex = 0;
  engine.state.currentTrickNumber = 2;
  (engine as unknown as { _trickNumber: number })._trickNumber = 2;
  return engine;
}

describe('GameEngine.getPlayableCardIds', () => {
  test('is empty outside TRICK_PLAYING, for other players and for unknown players', () => {
    const engine = makeEngine();
    engine.state.players[0].hand = [card('HEART', '5')];
    assert.deepEqual(engine.getPlayableCardIds('p0'), ['HEART_5']);
    assert.deepEqual(engine.getPlayableCardIds('p1'), []);
    assert.deepEqual(engine.getPlayableCardIds('nobody'), []);
    engine.state.phase = 'TRICK_RESOLVED';
    assert.deepEqual(engine.getPlayableCardIds('p0'), []);
  });

  test('must follow the lead suit; the joker stays playable', () => {
    const engine = makeEngine();
    engine.state.currentTurnIndex = 1;
    engine.state.currentTrick = {
      id: 't',
      trickNumber: 2,
      cards: [{ playerId: 'p0', playerIndex: 0, card: card('HEART', '9') }],
      leadSuit: 'HEART',
    } as never;
    engine.state.players[1].hand = [card('HEART', '2'), card('HEART', 'K'), card('CLUB', 'A'), card('JOKER', 'A')];
    assert.deepEqual(engine.getPlayableCardIds('p1').sort(), ['HEART_2', 'HEART_K', 'JOKER_A']);
  });

  test('any card is playable when the lead suit is missing', () => {
    const engine = makeEngine();
    engine.state.currentTurnIndex = 1;
    engine.state.currentTrick = {
      id: 't',
      trickNumber: 2,
      cards: [{ playerId: 'p0', playerIndex: 0, card: card('HEART', '9') }],
      leadSuit: 'HEART',
    } as never;
    engine.state.players[1].hand = [card('CLUB', '2'), card('SPADE', 'K')];
    assert.equal(engine.getPlayableCardIds('p1').length, 2);
  });

  test('the president may not lead the giruda or the joker on the first trick', () => {
    const engine = makeEngine('SPADE');
    (engine as unknown as { _trickNumber: number })._trickNumber = 1;
    engine.state.currentTrickNumber = 1;
    engine.state.currentTurnIndex = 0;
    engine.state.players[0].hand = [card('SPADE', '5'), card('JOKER', 'A'), card('HEART', '3')];
    assert.deepEqual(engine.getPlayableCardIds('p0'), ['HEART_3']);
  });

  test('a joker lead is offered on a later trick without needing a named suit', () => {
    const engine = makeEngine();
    engine.state.currentTurnIndex = 0;
    engine.state.players[0].hand = [card('JOKER', 'A'), card('HEART', '3')];
    assert.deepEqual(engine.getPlayableCardIds('p0').sort(), ['HEART_3', 'JOKER_A']);
  });

  test('the joker-call card must be played when the call is active', () => {
    const engine = makeEngine('SPADE'); // joker call = CLUB 3
    engine.state.currentTurnIndex = 1;
    engine.state.isJokerCallActive = true;
    engine.state.currentTrick = {
      id: 't',
      trickNumber: 2,
      cards: [{ playerId: 'p0', playerIndex: 0, card: card('CLUB', '3') }],
      leadSuit: 'CLUB',
    } as never;
    engine.state.players[1].hand = [card('CLUB', '3'), card('CLUB', '9'), card('HEART', '4')];
    assert.deepEqual(engine.getPlayableCardIds('p1'), ['CLUB_3']);
  });
});
