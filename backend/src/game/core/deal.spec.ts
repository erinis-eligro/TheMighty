import assert from 'node:assert/strict';
import { createDeck, shuffleDeck, validateDeck } from './deck';
import { dealCards } from './deal';
import { CARDS_PER_PLAYER, KITTY_SIZE, PLAYER_COUNT } from './rules';

test('dealCards: 5 hands of 10 cards plus a 3-card kitty, no card dealt twice', () => {
  const { hands, kitty } = dealCards(shuffleDeck(createDeck()));
  assert.equal(hands.length, PLAYER_COUNT);
  for (const hand of hands) assert.equal(hand.length, CARDS_PER_PLAYER);
  assert.equal(kitty.length, KITTY_SIZE);

  const ids = [...hands.flat(), ...kitty].map((c) => c.id);
  assert.equal(ids.length, 53);
  assert.equal(new Set(ids).size, 53);
});

test('dealCards: rejects a deck that is too small', () => {
  assert.throws(() => dealCards(createDeck().slice(0, 52)), /too small/);
});

test('validateDeck / shuffleDeck: shuffling keeps all 53 cards and does not mutate the input', () => {
  const deck = createDeck();
  const before = deck.map((c) => c.id);
  const shuffled = shuffleDeck(deck);
  assert.deepEqual(deck.map((c) => c.id), before);
  assert.equal(validateDeck(shuffled), true);
  assert.deepEqual(shuffled.map((c) => c.id).sort(), [...before].sort());
  assert.equal(validateDeck(deck.slice(1)), false);
});
