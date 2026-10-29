import { Card } from '../entities/game.entity';
import { SUITS, RANKS, getMightyCard } from './rules';

export const FRIEND_TYPES = ['NO_FRIEND', 'FIRST_TRICK', 'MIGHTY', 'JOKER', 'CARD'] as const;

export interface FriendTargetCard {
  suit: string;
  rank: string;
}

/** Result of a friend reveal; `friendPlayerId` is null when the president plays without a friend. */
export interface FriendReveal {
  friendPlayerId: string | null;
  friendIndex: number | null;
  reason:
    | 'NO_FRIEND'
    | 'PRESIDENT_HOLDS_CARD'
    | 'CARD_NOT_IN_PLAY'
    | 'CARD_PLAYED'
    | 'FIRST_TRICK_WON'
    | 'PRESIDENT_WON_FIRST_TRICK';
}

export interface FriendDeclarationValidation {
  valid: boolean;
  reason?: string;
}

/** Shape check of a friend declaration (the president's choice of condition). */
export function validateFriendDeclaration(declaration: {
  type?: string;
  suit?: string;
  rank?: string;
}): FriendDeclarationValidation {
  const type = declaration?.type;
  if (!type || !(FRIEND_TYPES as readonly string[]).includes(type)) {
    return { valid: false, reason: 'invalid_friend_type' };
  }
  if (type === 'CARD') {
    if (!declaration.suit || !(SUITS as readonly string[]).includes(declaration.suit)) {
      return { valid: false, reason: 'invalid_friend_suit' };
    }
    if (!declaration.rank || !(RANKS as readonly string[]).includes(declaration.rank)) {
      return { valid: false, reason: 'invalid_friend_rank' };
    }
  }
  return { valid: true };
}

/**
 * The card whose owner becomes the friend. `null` for conditions that do not
 * depend on a card (NO_FRIEND, FIRST_TRICK).
 */
export function resolveFriendTargetCard(
  declaration: { type: string; suit?: string; rank?: string },
  giruda: string
): FriendTargetCard | null {
  switch (declaration.type) {
    case 'MIGHTY':
      return getMightyCard(giruda);
    case 'JOKER':
      return { suit: 'JOKER', rank: '2' };
    case 'CARD':
      return { suit: declaration.suit as string, rank: declaration.rank as string };
    default:
      return null;
  }
}

export function isFriendTargetCard(card: Pick<Card, 'suit' | 'rank'>, target: FriendTargetCard): boolean {
  return card.suit === target.suit && card.rank === target.rank;
}

/** Index of the player holding the target card, or -1 if nobody does (e.g. it is in the kitty). */
export function findFriendHolder(hands: Pick<Card, 'suit' | 'rank'>[][], target: FriendTargetCard): number {
  return hands.findIndex((hand) => hand.some((c) => isFriendTargetCard(c, target)));
}
