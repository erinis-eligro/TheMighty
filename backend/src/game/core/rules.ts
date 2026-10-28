export const SUITS = ['SPADE', 'DIAMOND', 'HEART', 'CLUB'] as const;
export type Suit = (typeof SUITS)[number];

export const RANKS = ['3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A', '2'] as const;
export type Rank = (typeof RANKS)[number];

export const RANK_STRENGTH: Record<Rank, number> = {
  3: 1,
  4: 2,
  5: 3,
  6: 4,
  7: 5,
  8: 6,
  9: 7,
  10: 8,
  J: 9,
  Q: 10,
  K: 11,
  A: 12,
  2: 13,
};

export const POINT_RANKS = ['10', 'J', 'Q', 'K', 'A'] as const;
export const MIN_BID = 13;
export const TOTAL_TRICKS = 10;
export const CARDS_PER_PLAYER = 10;
export const KITTY_SIZE = 3;
export const PLAYER_COUNT = 5;
export const DECK_SIZE = 53;

export const JOKER_STRENGTH = 100;
export const MIGHTY_STRENGTH = 90;
export const GIRUDA_BASE_STRENGTH = 50;

export function isJokerCard(card: { suit: string; isJoker?: boolean }): boolean {
  return card.suit === 'JOKER' || card.isJoker === true;
}

export function isPointCard(card: { rank: string }): boolean {
  return POINT_RANKS.includes(card.rank as any);
}

export function getPointValue(card: { rank: string }): number {
  return isPointCard(card) ? 1 : 0;
}

export function getMightyCard(giruda: string): { suit: string; rank: string } {
  if (giruda === 'SPADE') {
    return { suit: 'DIAMOND', rank: 'A' };
  }
  return { suit: 'SPADE', rank: 'A' };
}

export function getJokerCallCard(giruda: string): { suit: string; rank: string } {
  if (giruda === 'CLUB') {
    return { suit: 'SPADE', rank: '3' };
  }
  return { suit: 'CLUB', rank: '3' };
}

export function isMightyCard(card: { suit: string; rank: string }, giruda: string): boolean {
  const mighty = getMightyCard(giruda);
  return card.suit === mighty.suit && card.rank === mighty.rank;
}

export function isJokerCallCard(card: { suit: string; rank: string }, giruda: string): boolean {
  const jokerCall = getJokerCallCard(giruda);
  return card.suit === jokerCall.suit && card.rank === jokerCall.rank;
}

export function cardBaseStrength(card: { rank: string }): number {
  return RANK_STRENGTH[card.rank as Rank] ?? 0;
}
