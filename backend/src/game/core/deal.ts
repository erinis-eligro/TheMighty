import { Card } from '../entities/game.entity';
import { CARDS_PER_PLAYER, KITTY_SIZE, PLAYER_COUNT } from './rules';

export function dealCards(deck: Card[]): { hands: Card[][]; kitty: Card[] } {
  if (deck.length < PLAYER_COUNT * CARDS_PER_PLAYER + KITTY_SIZE) {
    throw new Error('Deck is too small for a full deal');
  }

  const hands: Card[][] = [];
  let index = 0;

  for (let p = 0; p < PLAYER_COUNT; p++) {
    const hand: Card[] = [];
    for (let c = 0; c < CARDS_PER_PLAYER; c++) {
      hand.push(deck[index++]);
    }
    hands.push(hand);
  }

  const kitty: Card[] = [];
  for (let c = 0; c < KITTY_SIZE; c++) {
    kitty.push(deck[index++]);
  }

  return { hands, kitty };
}
