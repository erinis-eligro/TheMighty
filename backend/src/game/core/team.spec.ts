import assert from 'node:assert/strict';
import { GameEngine } from './game-engine';
import { isAlly } from './team';
import { getAiTurnDelayMs, AI_TURN_DELAY_MIN_MS, AI_TURN_DELAY_MAX_MS } from '../constants';
import { Card, Player } from '../entities/game.entity';

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

const card = (suit: Card['suit'], rank: Card['rank']): Card => ({
  suit,
  rank,
  isJoker: suit === 'JOKER',
  id: `${suit}_${rank}`,
});

describe('isAlly', () => {
  const base = { ownerPlayerId: 'p2', friendPlayerId: undefined, friendRevealed: false, viewerIsFriend: false };

  test('a player is always his own ally', () => {
    assert.equal(isAlly({ ...base, viewerId: 'p1', otherId: 'p1' }), true);
  });

  test('before the reveal an opposition player knows nobody but himself', () => {
    assert.equal(isAlly({ ...base, viewerId: 'p1', otherId: 'p2' }), false);
    assert.equal(isAlly({ ...base, viewerId: 'p1', otherId: 'p3' }), false);
  });

  test('before the reveal the president only counts himself as owner team', () => {
    assert.equal(isAlly({ ...base, viewerId: 'p2', otherId: 'p3' }), false);
  });

  test('the hidden friend knows the president', () => {
    assert.equal(isAlly({ ...base, viewerId: 'p3', otherId: 'p2', viewerIsFriend: true }), true);
    assert.equal(isAlly({ ...base, viewerId: 'p3', otherId: 'p1', viewerIsFriend: true }), false);
  });

  test('after the reveal both teams are known', () => {
    const revealed = { ...base, friendPlayerId: 'p3', friendRevealed: true };
    assert.equal(isAlly({ ...revealed, viewerId: 'p2', otherId: 'p3' }), true);
    assert.equal(isAlly({ ...revealed, viewerId: 'p3', otherId: 'p2', viewerIsFriend: true }), true);
    assert.equal(isAlly({ ...revealed, viewerId: 'p1', otherId: 'p4' }), true);
    assert.equal(isAlly({ ...revealed, viewerId: 'p1', otherId: 'p3' }), false);
    assert.equal(isAlly({ ...revealed, viewerId: 'p1', otherId: 'p2' }), false);
  });

  test('a reveal without a friend makes everybody but the president opposition', () => {
    const noFriend = { ...base, friendRevealed: true };
    assert.equal(isAlly({ ...noFriend, viewerId: 'p1', otherId: 'p4' }), true);
    assert.equal(isAlly({ ...noFriend, viewerId: 'p1', otherId: 'p2' }), false);
    assert.equal(isAlly({ ...noFriend, viewerId: 'p2', otherId: 'p1' }), false);
  });
});

describe('getCurrentTrickWinner', () => {
  function playingEngine(): GameEngine {
    const engine = new GameEngine({ players: makePlayers(), giruda: 'NO_GIRUDA' });
    engine.deal();
    engine.placeBid('p0', { pass: true });
    engine.placeBid('p1', { pass: true });
    engine.placeBid('p2', { score: 13, giruda: 'HEART' });
    engine.placeBid('p3', { pass: true });
    engine.placeBid('p4', { pass: true });
    const ids = [...engine.state.players[2].hand, ...engine.state.kitty].slice(0, 3).map((c) => c.id);
    engine.exchangeKitty('p2', { discardCardIds: ids });
    engine.declareFriend('p2', { type: 'NO_FRIEND' });
    return engine;
  }

  test('is null before the first card of a trick', () => {
    assert.equal(playingEngine().getCurrentTrickWinner(), null);
  });

  test('is the strongest card so far, not the last one played', () => {
    const engine = playingEngine();
    engine.state.players.forEach((p, i) => {
      p.hand = [card('CLUB', (['4', '9', '5', '3', '2'] as const)[i]), card('CLUB', '6')];
    });
    engine.playCard('p2', 'CLUB_5'); // lead
    engine.playCard('p3', 'CLUB_3');
    assert.equal(engine.getCurrentTrickWinner()?.winnerPlayerId, 'p2');
    engine.playCard('p4', 'CLUB_2');
    engine.playCard('p0', 'CLUB_4');
    assert.equal(engine.getCurrentTrickWinner()?.winnerPlayerId, 'p2');
  });

  test('a giruda cut beats the lead suit', () => {
    const engine = playingEngine();
    engine.state.players[2].hand = [card('CLUB', '5')];
    engine.state.players[3].hand = [card('HEART', '2')];
    engine.playCard('p2', 'CLUB_5');
    engine.playCard('p3', 'HEART_2');
    assert.equal(engine.getCurrentTrickWinner()?.winnerPlayerId, 'p3');
  });
});

describe('getAiTurnDelayMs', () => {
  test('stays within 1~1.5s', () => {
    assert.equal(getAiTurnDelayMs(() => 0), AI_TURN_DELAY_MIN_MS);
    assert.equal(getAiTurnDelayMs(() => 0.999999), AI_TURN_DELAY_MAX_MS);
    for (let i = 0; i < 100; i++) {
      const d = getAiTurnDelayMs();
      assert.ok(d >= AI_TURN_DELAY_MIN_MS && d <= AI_TURN_DELAY_MAX_MS);
    }
  });
});
