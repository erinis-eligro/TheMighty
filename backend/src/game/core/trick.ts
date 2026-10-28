import { Card } from '../entities/game.entity';
import {
  isJokerCard,
  isMightyCard,
  isJokerCallCard,
  isPointCard,
  cardBaseStrength,
  JOKER_STRENGTH,
  MIGHTY_STRENGTH,
  GIRUDA_BASE_STRENGTH,
} from './rules';

export interface PlayValidation {
  valid: boolean;
  reason?: string;
}

export function validatePlay({
  card,
  hand,
  leadSuit,
  turnNumber,
  totalTricks,
  giruda,
  jokerCallCard,
}: {
  card: Card;
  hand: Card[];
  leadSuit?: string;
  turnNumber: number;
  totalTricks: number;
  giruda: string;
  jokerCallCard?: { suit: string; rank: string };
}): PlayValidation {
  const inHand = hand.some((c) => c.id === card.id);
  if (!inHand) {
    return { valid: false, reason: 'card_not_in_hand' };
  }

  if (isJokerCard(card)) {
    if (turnNumber === 1 || turnNumber === totalTricks) {
      return { valid: false, reason: 'joker_not_allowed_first_or_last_trick' };
    }
  }

  if (jokerCallCard && isJokerCallCard(card, giruda)) {
    return { valid: true };
  }

  if (jokerCallCard) {
    const hasJokerCall = hand.some((c) => isJokerCallCard(c, giruda));
    if (hasJokerCall && !isJokerCallCard(card, giruda)) {
      return { valid: false, reason: 'must_play_joker_call_card' };
    }
  }

  if (leadSuit) {
    const hasLeadSuit = hand.some((c) => c.suit === leadSuit && !isJokerCard(c));
    if (hasLeadSuit && card.suit !== leadSuit && !isJokerCard(card)) {
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
}: {
  plays: { playerId: string; card: Card }[];
  leadSuit?: string;
  giruda: string;
  mightyCard: { suit: string; rank: string };
}): TrickResult {
  let best: { playerId: string; card: Card; strength: number } | null = null;

  for (const play of plays) {
    const { card, playerId } = play;
    let strength = 0;

    if (isJokerCard(card)) {
      strength = JOKER_STRENGTH;
    } else if (isMightyCard(card, giruda)) {
      strength = MIGHTY_STRENGTH;
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
