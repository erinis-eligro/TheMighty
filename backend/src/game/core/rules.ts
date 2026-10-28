export const SUITS = ['SPADE', 'DIAMOND', 'HEART', 'CLUB'] as const;
export type Suit = (typeof SUITS)[number];

export const RANKS = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'] as const;
export type Rank = (typeof RANKS)[number];

export const RANK_STRENGTH: Record<Rank, number> = {
  2: 2,
  3: 3,
  4: 4,
  5: 5,
  6: 6,
  7: 7,
  8: 8,
  9: 9,
  10: 10,
  J: 11,
  Q: 12,
  K: 13,
  A: 14,
};

export const POINT_RANKS = ['10', 'J', 'Q', 'K', 'A'] as const;
export const MIN_BID = 13;
export const MAX_BID = 20;
export const TOTAL_TRICKS = 10;
export const CARDS_PER_PLAYER = 10;
export const KITTY_SIZE = 3;
export const PLAYER_COUNT = 5;
export const DECK_SIZE = 53;

// Mighty beats joker, joker beats giruda, giruda beats the lead suit.
export const MIGHTY_STRENGTH = 100;
export const JOKER_STRENGTH = 90;
export const GIRUDA_BASE_STRENGTH = 50;
/** Strength of a joker that has no power (joker call / first / last trick): below any other card. */
export const POWERLESS_JOKER_STRENGTH = -1;

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

/**
 * The joker has no power (it is the weakest card of the trick) on the first and
 * last trick and in a trick where the joker call was declared.
 * `trickNumber` is the 1-based number of the trick, not a per-player turn.
 */
export function isJokerPowerless({
  trickNumber,
  totalTricks,
  isJokerCallActive,
}: {
  trickNumber: number;
  totalTricks: number;
  isJokerCallActive: boolean;
}): boolean {
  return isJokerCallActive || trickNumber === 1 || trickNumber === totalTricks;
}
