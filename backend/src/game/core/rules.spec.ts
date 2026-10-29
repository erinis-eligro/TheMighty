import assert from 'node:assert/strict';
import { createDeck } from './deck';
import {
  RANKS,
  RANK_STRENGTH,
  SUITS,
  DECK_SIZE,
  cardBaseStrength,
  getMightyCard,
  getJokerCallCard,
  isMightyCard,
  isJokerCallCard,
  isPointCard,
} from './rules';
import { determineTrickWinner } from './trick';

test('RANKS are ordered 2 (weakest) to A (strongest)', () => {
  assert.deepEqual(
    [...RANKS],
    ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A']
  );
});

test('RANK_STRENGTH is strictly increasing along RANKS (A=14, K=13, Q=12, J=11, 2=2)', () => {
  for (let i = 1; i < RANKS.length; i++) {
    assert.ok(RANK_STRENGTH[RANKS[i]] > RANK_STRENGTH[RANKS[i - 1]]);
  }
  assert.equal(RANK_STRENGTH.A, 14);
  assert.equal(RANK_STRENGTH.K, 13);
  assert.equal(RANK_STRENGTH.Q, 12);
  assert.equal(RANK_STRENGTH.J, 11);
  assert.equal(RANK_STRENGTH['2'], 2);
});

test('A is the strongest and 2 the weakest rank', () => {
  for (const rank of RANKS) {
    if (rank !== 'A') assert.ok(cardBaseStrength({ rank: 'A' }) > cardBaseStrength({ rank }));
    if (rank !== '2') assert.ok(cardBaseStrength({ rank: '2' }) < cardBaseStrength({ rank }));
  }
});

test('deck has 53 cards, 13 unique ranks per suit, plus the joker', () => {
  const deck = createDeck();
  assert.equal(deck.length, DECK_SIZE);
  for (const suit of SUITS) {
    const ranks = deck.filter((c) => c.suit === suit).map((c) => c.rank);
    assert.deepEqual([...ranks].sort(), [...RANKS].sort());
  }
  assert.equal(deck.filter((c) => c.isJoker).length, 1);
});

test('trick winner: A beats 2 in the lead suit and in giruda', () => {
  const card = (suit: string, rank: string, id: string) => ({ id, suit, rank, isJoker: false } as any);
  const mightyCard = { suit: 'SPADE', rank: 'A' };

  // lead suit (HEART), giruda is CLUB
  const lead = determineTrickWinner({
    plays: [
      { playerId: 'p1', card: card('HEART', '2', '1') },
      { playerId: 'p2', card: card('HEART', 'A', '2') },
    ],
    leadSuit: 'HEART',
    giruda: 'CLUB',
    mightyCard,
  });
  assert.equal(lead.winnerPlayerId, 'p2');

  // giruda comparison
  const trump = determineTrickWinner({
    plays: [
      { playerId: 'p1', card: card('CLUB', 'A', '3') },
      { playerId: 'p2', card: card('CLUB', '2', '4') },
    ],
    leadSuit: 'HEART',
    giruda: 'CLUB',
    mightyCard,
  });
  assert.equal(trump.winnerPlayerId, 'p1');
});

test('mighty: SPADE A, but DIAMOND A when the giruda is SPADE (all 4 suits + no-giruda)', () => {
  assert.deepEqual(getMightyCard('SPADE'), { suit: 'DIAMOND', rank: 'A' });
  for (const giruda of ['DIAMOND', 'HEART', 'CLUB', 'NO_GIRUDA']) {
    assert.deepEqual(getMightyCard(giruda), { suit: 'SPADE', rank: 'A' });
  }
  assert.equal(isMightyCard({ suit: 'SPADE', rank: 'A' }, 'SPADE'), false);
  assert.equal(isMightyCard({ suit: 'DIAMOND', rank: 'A' }, 'SPADE'), true);
  assert.equal(isMightyCard({ suit: 'SPADE', rank: 'A' }, 'NO_GIRUDA'), true);
});

test('joker call: CLUB 3, but SPADE 3 when the giruda is CLUB (all 4 suits + no-giruda)', () => {
  assert.deepEqual(getJokerCallCard('CLUB'), { suit: 'SPADE', rank: '3' });
  for (const giruda of ['SPADE', 'DIAMOND', 'HEART', 'NO_GIRUDA']) {
    assert.deepEqual(getJokerCallCard(giruda), { suit: 'CLUB', rank: '3' });
  }
  assert.equal(isJokerCallCard({ suit: 'CLUB', rank: '3' }, 'CLUB'), false);
  assert.equal(isJokerCallCard({ suit: 'SPADE', rank: '3' }, 'CLUB'), true);
  assert.equal(isJokerCallCard({ suit: 'CLUB', rank: '3' }, 'NO_GIRUDA'), true);
});

test('point cards: exactly 20 in the deck (10, J, Q, K, A of each suit)', () => {
  const points = createDeck().filter((c) => isPointCard(c));
  assert.equal(points.length, 20);
  assert.ok(points.every((c) => !c.isJoker));
});

test('trick winner priority: mighty > joker > giruda > lead suit > off-suit', () => {
  const c = (suit: string, rank: string) => ({ id: `${suit}${rank}`, suit, rank, isJoker: suit === 'JOKER' } as any);
  const winner = (cards: ReturnType<typeof c>[]) =>
    determineTrickWinner({
      plays: cards.map((card, i) => ({ playerId: `p${i}`, card })),
      leadSuit: 'HEART',
      giruda: 'CLUB',
      mightyCard: getMightyCard('CLUB'),
    }).winnerPlayerId;

  assert.equal(winner([c('HEART', 'A'), c('SPADE', 'K')]), 'p0', 'lead suit beats off-suit');
  assert.equal(winner([c('HEART', 'A'), c('CLUB', '2')]), 'p1', 'giruda beats lead suit');
  assert.equal(winner([c('CLUB', 'A'), c('JOKER', '2')]), 'p1', 'joker beats giruda');
  assert.equal(winner([c('JOKER', '2'), c('SPADE', 'A')]), 'p1', 'mighty beats joker');
});
