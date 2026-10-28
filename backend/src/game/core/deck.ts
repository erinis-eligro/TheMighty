import { Card } from '../entities/game.entity';
import { SUITS, RANKS, DECK_SIZE } from './rules';

export function createDeck(): Card[] {
  const cards: Card[] = [];
  let id = 0;

  for (const suit of SUITS) {
    for (const rank of RANKS) {
      cards.push({
        id: `${id++}`,
        suit: suit as Card['suit'],
        rank: rank as Card['rank'],
        isJoker: false,
      });
    }
  }

  cards.push({
    id: `${id++}`,
    suit: 'JOKER',
    rank: '2',
    isJoker: true,
  });

  return cards;
}

export function shuffleDeck(deck: Card[]): Card[] {
  const result = [...deck];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const tmp = result[i];
    result[i] = result[j];
    result[j] = tmp;
  }
  return result;
}

export function validateDeck(deck: Card[]): boolean {
  return deck.length === DECK_SIZE;
}
