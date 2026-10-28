import { Bid, BidGiruda } from '../entities/game.entity';
import { MIN_BID, MAX_BID } from './rules';

export const BID_GIRUDAS: readonly BidGiruda[] = ['SPADE', 'DIAMOND', 'HEART', 'CLUB', 'NO_GIRUDA'];

export interface BidValidation {
  valid: boolean;
  reason?: string;
}

/**
 * Orders bids: a higher score always wins, and at the same score a
 * no-giruda bid outranks a suited bid.
 */
export function bidRank(score: number, giruda: BidGiruda): number {
  return score * 2 + (giruda === 'NO_GIRUDA' ? 1 : 0);
}

export function validateBid({
  score,
  giruda,
  currentBid,
  isPass,
}: {
  score?: number;
  giruda?: string;
  currentBid?: Bid | null;
  isPass?: boolean;
}): BidValidation {
  if (isPass) {
    return { valid: true };
  }

  if (score === undefined || score === null) {
    return { valid: false, reason: 'bid_required' };
  }

  if (!Number.isInteger(score)) {
    return { valid: false, reason: 'bid_must_be_integer' };
  }

  if (score < MIN_BID) {
    return { valid: false, reason: 'bid_below_minimum' };
  }

  if (score > MAX_BID) {
    return { valid: false, reason: 'bid_above_maximum' };
  }

  if (!giruda) {
    return { valid: false, reason: 'giruda_required' };
  }

  if (!BID_GIRUDAS.includes(giruda as BidGiruda)) {
    return { valid: false, reason: 'invalid_giruda' };
  }

  if (currentBid && bidRank(score, giruda as BidGiruda) <= bidRank(currentBid.score, currentBid.giruda)) {
    return { valid: false, reason: 'bid_must_exceed_current' };
  }

  return { valid: true };
}

/** Lowest score that legally beats `currentBid` with `giruda`, or null if none exists. */
export function lowestValidScore(giruda: BidGiruda, currentBid: Bid | null): number | null {
  for (let score = MIN_BID; score <= MAX_BID; score++) {
    if (validateBid({ score, giruda, currentBid }).valid) return score;
  }
  return null;
}
