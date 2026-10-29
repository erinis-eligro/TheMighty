import assert from 'node:assert/strict';
import { GameEngine } from './game-engine';
import { validateFriendDeclaration, resolveFriendTargetCard } from './friend';
import { selectFriendDeclaration } from './ai';
import { scoreRound } from './score';
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

const card = (suit: Card['suit'], rank: Card['rank'], id: string): Card => ({
  suit,
  rank,
  id,
  isJoker: suit === 'JOKER',
});

/** Engine in FRIEND_SELECTION with p0 as president and the given hands (giruda HEART). */
function friendPhaseEngine(hands: Card[][]): GameEngine {
  const engine = new GameEngine({ players: makePlayers(), giruda: 'NO_GIRUDA' });
  engine.deal();
  engine.placeBid('p0', { score: 13, giruda: 'HEART' });
  for (const id of ['p1', 'p2', 'p3', 'p4']) engine.placeBid(id, { pass: true });
  assert.equal(engine.state.phase, 'KITTY_EXCHANGE');
  engine.state.players.forEach((p, i) => (p.hand = hands[i]));
  engine.transition('FRIEND_SELECTION');
  return engine;
}

/** Ten distinct filler cards per seat so that hands are legal for play. */
function hands(overrides: Record<number, Card[]> = {}): Card[][] {
  return [0, 1, 2, 3, 4].map((seat) => {
    const base = overrides[seat] ?? [];
    // No 3s: the club 3 is the joker call card and would force the play.
    const filler = ['2', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q'].slice(0, 10 - base.length);
    const suit = (['CLUB', 'DIAMOND', 'SPADE', 'SPADE', 'CLUB'] as const)[seat];
    return [...base, ...filler.map((r, i) => card(suit, r as Card['rank'], `f${seat}-${i}`))];
  });
}

test('validateFriendDeclaration checks type and the CARD target', () => {
  assert.equal(validateFriendDeclaration({ type: 'NO_FRIEND' }).valid, true);
  assert.equal(validateFriendDeclaration({ type: 'FIRST_TRICK' }).valid, true);
  assert.equal(validateFriendDeclaration({ type: 'MIGHTY' }).valid, true);
  assert.equal(validateFriendDeclaration({ type: 'CARD', suit: 'HEART', rank: 'A' }).valid, true);
  assert.equal(validateFriendDeclaration({ type: 'BOGUS' }).reason, 'invalid_friend_type');
  assert.equal(validateFriendDeclaration({}).reason, 'invalid_friend_type');
  assert.equal(validateFriendDeclaration({ type: 'CARD', rank: 'A' }).reason, 'invalid_friend_suit');
  assert.equal(validateFriendDeclaration({ type: 'CARD', suit: 'HEART', rank: '1' }).reason, 'invalid_friend_rank');
});

test('resolveFriendTargetCard follows the giruda for the mighty', () => {
  assert.deepEqual(resolveFriendTargetCard({ type: 'MIGHTY' }, 'HEART'), { suit: 'SPADE', rank: 'A' });
  assert.deepEqual(resolveFriendTargetCard({ type: 'MIGHTY' }, 'SPADE'), { suit: 'DIAMOND', rank: 'A' });
  assert.deepEqual(resolveFriendTargetCard({ type: 'JOKER' }, 'HEART'), { suit: 'JOKER', rank: '2' });
  assert.equal(resolveFriendTargetCard({ type: 'FIRST_TRICK' }, 'HEART'), null);
  assert.equal(resolveFriendTargetCard({ type: 'NO_FRIEND' }, 'HEART'), null);
});

test('declareFriend: only the president, only in FRIEND_SELECTION, with a valid declaration', () => {
  const engine = friendPhaseEngine(hands());
  assert.throws(() => engine.declareFriend('p1', { type: 'NO_FRIEND' }), /Only the president/);
  assert.throws(() => engine.declareFriend('p0', { type: 'CARD', suit: 'HEART' }), /invalid_friend_rank/);
  assert.throws(() => engine.declareFriend('nobody', { type: 'NO_FRIEND' }), /Player not found/);
  // Rejected calls leave the phase untouched.
  assert.equal(engine.state.phase, 'FRIEND_SELECTION');

  engine.declareFriend('p0', { type: 'NO_FRIEND' });
  assert.equal(engine.state.phase, 'TRICK_PLAYING');
  assert.throws(() => engine.declareFriend('p0', { type: 'NO_FRIEND' }), /Not in friend selection phase/);
});

test('declareFriend: a mighty friend stays hidden (friendIndex null) until the mighty is played', () => {
  const mighty = card('SPADE', 'A', 'm');
  const engine = friendPhaseEngine(hands({ 2: [mighty] }));
  const declared = engine.declareFriend('p0', { type: 'MIGHTY' });

  assert.equal(declared.friendRevealed, undefined);
  assert.equal(engine.state.friendRevealed, false);
  assert.equal(engine.state.friendIndex, null);
  assert.equal(engine.state.friendPlayerId, undefined);
  assert.equal(engine.state.players.some((p) => p.isFriend), false);
  assert.equal(engine.isFriend('p2'), true);
  assert.equal(engine.state.currentTurnIndex, 0);

  // p0 leads CLUB; p1 follows; p2 plays the mighty (void in CLUB would be needed otherwise).
  engine.playCard('p0', 'f0-0');
  engine.playCard('p1', engine.state.players[1].hand.find((c) => c.suit === 'DIAMOND')!.id);
  // p2 holds only DIAMOND filler + mighty (SPADE): void in CLUB, so any card is legal.
  const r = engine.playCard('p2', 'm');
  assert.deepEqual(r.friendRevealed, { friendPlayerId: 'p2', friendIndex: 2, reason: 'CARD_PLAYED' });
  assert.equal(engine.state.friendRevealed, true);
  assert.equal(engine.state.friendIndex, 2);
  assert.equal(engine.state.friendPlayerId, 'p2');
  assert.equal(engine.state.players[2].isFriend, true);
});

test('declareFriend: the president holding the declared card plays without a friend, revealed at once', () => {
  const engine = friendPhaseEngine(hands({ 0: [card('SPADE', 'A', 'm')] }));
  const r = engine.declareFriend('p0', { type: 'MIGHTY' });
  assert.deepEqual(r.friendRevealed, { friendPlayerId: null, friendIndex: null, reason: 'PRESIDENT_HOLDS_CARD' });
  assert.equal(engine.state.friendRevealed, true);
  assert.equal(engine.state.friendIndex, null);
  assert.equal(engine.state.players.some((p) => p.isFriend), false);
  assert.equal([0, 1, 2, 3, 4].some((i) => engine.isFriend(`p${i}`)), false);
});

test('declareFriend: a card nobody holds (discarded) means no friend', () => {
  const engine = friendPhaseEngine(hands());
  const r = engine.declareFriend('p0', { type: 'CARD', suit: 'HEART', rank: 'A' });
  assert.equal(r.friendRevealed?.reason, 'CARD_NOT_IN_PLAY');
  assert.equal(engine.state.friendRevealed, true);
  assert.equal(engine.state.friendIndex, null);
});

test('declareFriend: a specific card friend is found among the other players', () => {
  const engine = friendPhaseEngine(hands({ 4: [card('HEART', 'A', 'ha')] }));
  const r = engine.declareFriend('p0', { type: 'CARD', suit: 'HEART', rank: 'A' });
  assert.equal(r.friendRevealed, undefined);
  assert.deepEqual(engine.state.friendDeclaration, { type: 'CARD', suit: 'HEART', rank: 'A' });
  assert.equal(engine.isFriend('p4'), true);
  assert.equal(engine.state.friendIndex, null);
});

test('declareFriend: NO_FRIEND is revealed immediately with no friend', () => {
  const engine = friendPhaseEngine(hands());
  const r = engine.declareFriend('p0', { type: 'NO_FRIEND' });
  assert.deepEqual(r.friendRevealed, { friendPlayerId: null, friendIndex: null, reason: 'NO_FRIEND' });
  assert.equal(engine.state.friendRevealed, true);
});

test('first-trick friend: revealed when the first trick is resolved, winner other than the president', () => {
  // p0 leads CLUB 2, p1..p4 each hold their own suit filler; p4 holds CLUB (higher) and wins.
  const engine = friendPhaseEngine(hands({ 4: [card('CLUB', 'A', 'ca')] }));
  const declared = engine.declareFriend('p0', { type: 'FIRST_TRICK' });
  assert.equal(declared.friendRevealed, undefined);
  assert.equal(engine.state.friendRevealed, false);

  engine.playCard('p0', 'f0-0'); // CLUB 2
  // p1 holds DIAMOND only (void in CLUB), p2 and p3 SPADE: all off-suit, none is giruda.
  engine.playCard('p1', 'f1-0');
  engine.playCard('p2', 'f2-0');
  engine.playCard('p3', 'f3-0');
  // Mid trick the friend is still unknown.
  assert.equal(engine.state.friendRevealed, false);
  const r = engine.playCard('p4', 'ca');

  assert.equal(r.trickComplete, true);
  assert.equal(r.trick?.winnerPlayerId, 'p4');
  assert.deepEqual(r.friendRevealed, { friendPlayerId: 'p4', friendIndex: 4, reason: 'FIRST_TRICK_WON' });
  assert.equal(engine.state.friendIndex, 4);
  assert.equal(engine.state.players[4].isFriend, true);
});

test('first-trick friend: the president winning trick 1 means no friend', () => {
  const engine = friendPhaseEngine(hands({ 0: [card('CLUB', 'A', 'ca')] }));
  engine.declareFriend('p0', { type: 'FIRST_TRICK' });
  engine.playCard('p0', 'ca');
  engine.playCard('p1', 'f1-0');
  engine.playCard('p2', 'f2-0');
  engine.playCard('p3', 'f3-0');
  const r = engine.playCard('p4', 'f4-0');
  assert.equal(r.friendRevealed?.reason, 'PRESIDENT_WON_FIRST_TRICK');
  assert.equal(r.friendRevealed?.friendPlayerId, null);
  assert.equal(engine.state.friendRevealed, true);
  assert.equal(engine.state.friendIndex, null);
});

test('scoring: a hidden friend already counts for the president team; no friend means the president alone', () => {
  // Friend p4 holds the declared HEART A (giruda). The president p0 leads DIAMOND 10 and p4 wins with HEART A.
  const playTrick = (declaration: { type: string; suit?: string; rank?: string }) => {
    const engine = friendPhaseEngine(hands({ 0: [card('DIAMOND', '10', 'd10')], 4: [card('HEART', 'A', 'ha')] }));
    engine.declareFriend('p0', declaration);
    engine.playCard('p0', 'd10');
    engine.playCard('p1', 'f1-0');
    // p2, p3 and p4 are void in DIAMOND, so any card is legal.
    engine.playCard('p2', 'f2-0');
    engine.playCard('p3', 'f3-0');
    const r = engine.playCard('p4', 'ha');
    assert.equal(r.trick?.winnerPlayerId, 'p4');
    assert.equal(r.points, 2); // DIAMOND 10 + HEART A
    return scoreRound({
      players: engine.state.players,
      ownerPlayerId: engine.state.ownerPlayerId,
      friendPlayerId: engine.state.friendPlayerId,
      bidScore: 13,
      giruda: 'HEART',
    });
  };

  const withFriend = playTrick({ type: 'CARD', suit: 'HEART', rank: 'A' });
  assert.equal(withFriend.friendPlayerId, 'p4');
  assert.equal(withFriend.teamPoints, 2);
  assert.equal(withFriend.opponentPoints, 0);

  // Same trick with NO_FRIEND: p4's win does not count for the president.
  const solo = playTrick({ type: 'NO_FRIEND' });
  assert.equal(solo.friendPlayerId, null);
  assert.equal(solo.teamPoints, 0);
  assert.equal(solo.opponentPoints, 2);
});

test('selectFriendDeclaration picks a card the AI president does not hold', () => {
  const none: Card[] = [card('CLUB', '2', 'a')];
  assert.deepEqual(selectFriendDeclaration({ hand: none, giruda: 'HEART' }), { type: 'MIGHTY' });
  const withMighty = [card('SPADE', 'A', 'm')];
  assert.deepEqual(selectFriendDeclaration({ hand: withMighty, giruda: 'HEART' }), { type: 'JOKER' });
  const both = [card('SPADE', 'A', 'm'), card('JOKER', '2', 'j')];
  assert.deepEqual(selectFriendDeclaration({ hand: both, giruda: 'HEART' }), { type: 'CARD', suit: 'HEART', rank: 'A' });
  const withAce = [...both, card('HEART', 'A', 'ha')];
  assert.deepEqual(selectFriendDeclaration({ hand: withAce, giruda: 'HEART' }), { type: 'CARD', suit: 'HEART', rank: 'K' });
  const all = [...withAce, card('HEART', 'K', 'hk')];
  assert.deepEqual(selectFriendDeclaration({ hand: all, giruda: 'HEART' }), { type: 'NO_FRIEND' });
  // A discarded card is held by nobody, so it is not worth calling.
  const discarded = [card('HEART', 'A', 'x')];
  assert.deepEqual(selectFriendDeclaration({ hand: both, giruda: 'HEART', discarded }), { type: 'CARD', suit: 'HEART', rank: 'K' });
  // No giruda: after mighty and joker the side-suit aces are called.
  assert.deepEqual(selectFriendDeclaration({ hand: both, giruda: 'NO_GIRUDA' }), { type: 'CARD', suit: 'DIAMOND', rank: 'A' });
});
