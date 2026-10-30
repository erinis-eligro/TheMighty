import { Card } from '../entities/game.entity';
import {
  isJokerCard,
  isMightyCard,
  isJokerCallCard,
  isPointCard,
  cardBaseStrength,
  JOKER_STRENGTH,
  POWERLESS_JOKER_STRENGTH,
  SUITS,
  Suit,
  MIGHTY_STRENGTH,
  GIRUDA_BASE_STRENGTH,
} from './rules';

export interface PlayValidation {
  valid: boolean;
  reason?: string;
}

/**
 * Validates one card play.
 *
 * - `trickNumber` is the 1-based number of the trick being played (1..totalTricks),
 *   not a per-player turn counter.
 * - `isLeading` is true when the player opens the trick; `leadSuit` is the suit led by the
 *   leader (undefined while leading).
 * - `isJokerCallActive` means the joker call was already declared in the current trick
 *   (by the leader). Only then must the holder of the joker-call card play it.
 * - `declaresJokerCall` is the leader declaring the joker call; it requires leading with the
 *   joker-call card.
 * - `jokerLeadSuit` is the suit named by a leader who leads with the joker.
 *
 * The joker is exempt from following suit. The mighty is an ordinary card of its own suit for
 * follow-suit purposes. On the first/last trick and in a joker-call trick the joker may be
 * played but has no power (see `isJokerPowerless`); it cannot lead the first trick.
 */
export function validatePlay({
  card,
  hand,
  leadSuit,
  isLeading = leadSuit === undefined,
  trickNumber,
  totalTricks,
  giruda,
  restrictGirudaLead,
  isJokerCallActive = false,
  declaresJokerCall = false,
  jokerLeadSuit,
}: {
  card: Card;
  hand: Card[];
  leadSuit?: string;
  isLeading?: boolean;
  trickNumber: number;
  totalTricks: number;
  giruda: string;
  /** First trick, president leading: the giruda may not be led (unless it is all they can play). */
  restrictGirudaLead?: boolean;
  isJokerCallActive?: boolean;
  declaresJokerCall?: boolean;
  jokerLeadSuit?: string;
}): PlayValidation {
  const inHand = hand.some((c) => c.id === card.id);
  if (!inHand) {
    return { valid: false, reason: 'card_not_in_hand' };
  }

  if (isLeading) {
    if (
      restrictGirudaLead &&
      giruda !== 'NO_GIRUDA' &&
      card.suit === giruda &&
      !isJokerCard(card)
    ) {
      const hasOther = hand.some((c) => c.suit !== giruda && !isJokerCard(c));
      if (hasOther) {
        return { valid: false, reason: 'cannot_lead_giruda_on_first_trick' };
      }
    }
    if (declaresJokerCall && !isJokerCallCard(card, giruda)) {
      return { valid: false, reason: 'joker_call_requires_joker_call_card' };
    }
    if (isJokerCard(card)) {
      if (trickNumber === 1) {
        return { valid: false, reason: 'joker_cannot_lead_first_trick' };
      }
      // The leader must always name the suit to follow (also on the last trick); without a lead
      // suit the trick winner could not be decided by rank.
      if (jokerLeadSuit === undefined || !SUITS.includes(jokerLeadSuit as Suit)) {
        return { valid: false, reason: 'joker_lead_suit_required' };
      }
    }
    return { valid: true };
  }

  if (declaresJokerCall) {
    return { valid: false, reason: 'joker_call_only_when_leading' };
  }

  if (isJokerCallActive) {
    if (isJokerCallCard(card, giruda)) {
      return { valid: true };
    }
    if (hand.some((c) => isJokerCallCard(c, giruda))) {
      return { valid: false, reason: 'must_play_joker_call_card' };
    }
  }

  if (leadSuit && !isJokerCard(card)) {
    const hasLeadSuit = hand.some((c) => c.suit === leadSuit && !isJokerCard(c));
    if (hasLeadSuit && card.suit !== leadSuit) {
      return { valid: false, reason: 'must_follow_lead_suit' };
    }
  }

  return { valid: true };
}

export interface TrickResult {
  winnerPlayerId: string;
  winningCard: Card;
  points: number;
}

export function determineTrickWinner({
  plays,
  leadSuit,
  giruda,
  mightyCard,
  jokerPowerless = false,
}: {
  plays: { playerId: string; card: Card }[];
  leadSuit?: string;
  giruda: string;
  mightyCard: { suit: string; rank: string };
  /** The joker is the weakest card of this trick (first/last trick or joker call). */
  jokerPowerless?: boolean;
}): TrickResult {
  let best: { playerId: string; card: Card; strength: number } | null = null;

  for (const play of plays) {
    const { card, playerId } = play;
    let strength = 0;

    if (isMightyCard(card, giruda)) {
      strength = MIGHTY_STRENGTH;
    } else if (isJokerCard(card)) {
      strength = jokerPowerless ? POWERLESS_JOKER_STRENGTH : JOKER_STRENGTH;
    } else if (card.suit === giruda) {
      strength = GIRUDA_BASE_STRENGTH + cardBaseStrength(card);
    } else if (leadSuit && card.suit === leadSuit) {
      strength = cardBaseStrength(card);
    } else {
      strength = 0;
    }

    if (!best || strength > best.strength) {
      best = { playerId, card, strength };
    }
  }

  if (!best) {
    throw new Error('No plays to determine winner');
  }

  const points = plays.reduce((sum, p) => sum + (isPointCard(p.card) ? 1 : 0), 0);

  return {
    winnerPlayerId: best.playerId,
    winningCard: best.card,
    points,
  };
}
