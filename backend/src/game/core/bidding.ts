import { MIN_BID } from './rules';

export interface BidValidation {
  valid: boolean;
  reason?: string;
}

export function validateBid({
  bid,
  currentBid,
  isPass,
}: {
  bid?: number;
  currentBid?: number;
  isPass?: boolean;
}): BidValidation {
  if (isPass) {
    return { valid: true };
  }

  if (bid === undefined) {
    return { valid: false, reason: 'bid_required' };
  }

  if (bid < MIN_BID) {
    return { valid: false, reason: 'bid_below_minimum' };
  }

  if (currentBid !== undefined && bid <= currentBid) {
    return { valid: false, reason: 'bid_must_exceed_current' };
  }

  return { valid: true };
}
