import type { Card } from '@/store/useGameStore';

const RANK_ORDER: Card['rank'][] = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'];
const SUIT_ORDER: Card['suit'][] = ['SPADE', 'DIAMOND', 'HEART', 'CLUB'];

/** Hand display order: joker first, then the giruda suit, then the other suits; strongest rank first. Hidden cards keep their place. */
export function sortHand<T extends Pick<Card, 'suit' | 'rank'>>(cards: T[], giruda: string): T[] {
  const suitKey = (suit: Card['suit']) => {
    if (suit === 'JOKER') return -2;
    if (suit === giruda) return -1;
    return SUIT_ORDER.indexOf(suit);
  };
  return [...cards].sort(
    (a, b) => suitKey(a.suit) - suitKey(b.suit) || RANK_ORDER.indexOf(b.rank) - RANK_ORDER.indexOf(a.rank),
  );
}
