import { Card, Player, Bid, BidGiruda } from '../entities/game.entity';
import {
  getMightyCard,
  getJokerCallCard,
  isMightyCard,
  isJokerCard,
  isJokerCallCard,
  isJokerPowerless,
  isPointCard,
  cardBaseStrength,
  RANK_STRENGTH,
  JOKER_STRENGTH,
  POWERLESS_JOKER_STRENGTH,
  MIGHTY_STRENGTH,
  GIRUDA_BASE_STRENGTH,
  MIN_BID,
  MAX_BID,
  Suit,
  SUITS,
  Rank,
} from './rules';
import { validatePlay } from './trick';
import { validateBid, lowestValidScore } from './bidding';

export interface AiBidDecision {
  /** null = pass */
  bid: number | null;
  /** Declared giruda; null when passing. */
  giruda: BidGiruda | null;
  reason: string;
}

export interface AiPlayDecision {
  cardId: string;
  reason: string;
  /** The leader declares the joker call with this play. */
  jokerCall?: boolean;
  /** Suit named when leading with the joker. */
  jokerLeadSuit?: string;
}

const AI_NAMES = ['AI 동서', 'AI 남서', 'AI 북서', 'AI 북동'];

export function generateAiName(index: number): string {
  return AI_NAMES[index] ?? `AI ${index + 1}`;
}

function countPoints(hand: Card[]): number {
  return hand.filter((c) => isPointCard(c)).length;
}

function suitLength(hand: Card[], suit: string): number {
  return hand.filter((c) => c.suit === suit && !isJokerCard(c)).length;
}

function handStrength(hand: Card[], giruda: string): number {
  let score = 0;
  const mighty = getMightyCard(giruda);
  for (const c of hand) {
    if (isJokerCard(c)) {
      score += 20;
      continue;
    }
    if (isMightyCard(c, giruda)) {
      score += 18;
      continue;
    }
    if (c.suit === giruda) {
      score += 10 + (RANK_STRENGTH[c.rank as Rank] ?? 0);
      continue;
    }
    score += (RANK_STRENGTH[c.rank as Rank] ?? 0) * 0.8;
    if (isPointCard(c)) score += 2;
  }
  return score;
}

export function selectBid({
  hand,
  currentBid,
}: {
  hand: Card[];
  currentBid: Bid | null;
}): AiBidDecision {
  const points = countPoints(hand);
  const bestSuit = (['SPADE', 'DIAMOND', 'HEART', 'CLUB'] as Suit[]).reduce(
    (best, s) => (suitLength(hand, s) > suitLength(hand, best) ? s : best),
    'SPADE'
  );
  const longSuit = suitLength(hand, bestSuit);
  // Declare the longest suit as giruda, evaluating the hand with that giruda.
  const giruda: BidGiruda = bestSuit;
  const strength = handStrength(hand, giruda);

  const lowest = lowestValidScore(giruda, currentBid);
  if (lowest === null) {
    return { bid: null, giruda: null, reason: 'cannot_outbid' };
  }

  // Strong hand: bid
  if (strength >= 45 || (points >= 5 && longSuit >= 4)) {
    const wanted = Math.min(MAX_BID, Math.floor(strength / 2) + 10);
    const bid = Math.max(lowest, wanted);
    if (bid <= MAX_BID && validateBid({ score: bid, giruda, currentBid }).valid) {
      return { bid, giruda, reason: 'strong_hand' };
    }
  }

  // Marginal: bid only if the minimum bid is still open
  if (strength >= 30 && lowest === MIN_BID && !currentBid) {
    return { bid: MIN_BID, giruda, reason: 'marginal_min_bid' };
  }

  return { bid: null, giruda: null, reason: 'pass' };
}

function cardPlayStrength(card: Card, giruda: string, jokerPowerless = false): number {
  if (isMightyCard(card, giruda)) return MIGHTY_STRENGTH;
  if (isJokerCard(card)) return jokerPowerless ? POWERLESS_JOKER_STRENGTH : JOKER_STRENGTH;
  if (card.suit === giruda) return GIRUDA_BASE_STRENGTH + (RANK_STRENGTH[card.rank as Rank] ?? 0);
  return RANK_STRENGTH[card.rank as Rank] ?? 0;
}

/** Suit the AI names when leading with the joker: its longest suit (ties: first in SUITS order). */
function pickJokerLeadSuit(hand: Card[]): string {
  return SUITS.reduce((best, s) => (suitLength(hand, s) > suitLength(hand, best) ? s : best), SUITS[0]);
}

export function selectCardToPlay({
  hand,
  leadSuit,
  currentTrickPlays,
  giruda,
  trickNumber,
  totalTricks,
  isPartnerWinningCurrentTrick,
  mightyCard,
  jokerCallCard,
  isJokerCallActive = false,
}: {
  hand: Card[];
  leadSuit?: string;
  currentTrickPlays: { playerId: string; card: Card }[];
  giruda: string;
  /** 1-based number of the trick being played. */
  trickNumber: number;
  totalTricks: number;
  isPartnerWinningCurrentTrick: boolean;
  mightyCard: { suit: string; rank: string };
  /** Only needed to decide whether to declare the joker call when leading. */
  jokerCallCard?: { suit: string; rank: string };
  /** The joker call was already declared in the current trick. */
  isJokerCallActive?: boolean;
}): AiPlayDecision {
  const isLeading = currentTrickPlays.length === 0;
  const jokerPowerless = isJokerPowerless({ trickNumber, totalTricks, isJokerCallActive });

  const valid = hand.filter((c) => {
    const v = validatePlay({
      card: c,
      hand,
      leadSuit,
      isLeading,
      trickNumber,
      totalTricks,
      giruda,
      isJokerCallActive,
      jokerLeadSuit: isLeading && isJokerCard(c) ? pickJokerLeadSuit(hand) : undefined,
    });
    return v.valid;
  });

  if (valid.length === 0) {
    throw new Error('No valid card to play');
  }

  // Must play the joker call card while the call is active.
  if (isJokerCallActive && !isLeading) {
    const jokerCall = valid.find((c) => isJokerCallCard(c, giruda));
    if (jokerCall) {
      return { cardId: jokerCall.id, reason: 'forced_joker_call' };
    }
  }

  // Leader holding the joker-call card (but not the joker) calls the joker in the middle tricks.
  if (
    isLeading &&
    jokerCallCard &&
    trickNumber > 1 &&
    trickNumber < totalTricks &&
    !hand.some((c) => isJokerCard(c))
  ) {
    const call = valid.find((c) => isJokerCallCard(c, giruda));
    if (call) {
      return { cardId: call.id, reason: 'declare_joker_call', jokerCall: true };
    }
  }


  if (isLeading) {
    // Lead: play a strong safe card; avoid leading point cards early
    const nonPoint = valid.filter((c) => !isPointCard(c));
    const candidates = nonPoint.length > 0 ? nonPoint : valid;
    // Prefer leading trump/giruda or strongest non-point
    candidates.sort((a, b) => cardPlayStrength(b, giruda, jokerPowerless) - cardPlayStrength(a, giruda, jokerPowerless));
    // Don't lead mighty/joker too early unless late
    const safe = candidates.find(
      (c) => !isJokerCard(c) && !isMightyCard(c, giruda) && trickNumber < totalTricks - 2
    );
    const chosen = safe ?? candidates[0];
    if (isJokerCard(chosen)) {
      return { cardId: chosen.id, reason: 'lead_safe', jokerLeadSuit: pickJokerLeadSuit(hand) };
    }
    return { cardId: chosen.id, reason: 'lead_safe' };
  }

  // Following: determine if we can win this trick
  const currentBest = currentTrickPlays.reduce(
    (best, p) => {
      const s = cardPlayStrength(p.card, giruda, jokerPowerless);
      return s > best.strength ? { playerId: p.playerId, strength: s } : best;
    },
    { playerId: '', strength: -1 }
  );

  const canWin = valid.some((c) => cardPlayStrength(c, giruda, jokerPowerless) > currentBest.strength);

  if (isPartnerWinningCurrentTrick) {
    // Partner is winning: dump low card or off-suit low, avoid giving points unnecessarily
    const low = valid
      .filter((c) => !isPointCard(c))
      .sort((a, b) => cardPlayStrength(a, giruda, jokerPowerless) - cardPlayStrength(b, giruda, jokerPowerless));
    const chosen = low[0] ?? valid[0];
    return { cardId: chosen.id, reason: 'partner_winning_dump' };
  }

  if (canWin) {
    // We can win: win cheaply if we want points, else play just enough
    const winning = valid
      .filter((c) => cardPlayStrength(c, giruda, jokerPowerless) > currentBest.strength)
      .sort((a, b) => cardPlayStrength(a, giruda, jokerPowerless) - cardPlayStrength(b, giruda, jokerPowerless));
    const chosen = winning[0];
    return { cardId: chosen.id, reason: 'win_cheaply' };
  }

  // Cannot win: dump lowest card, preferably point card to shed (sandbag on opponent)
  const dump = valid.sort((a, b) => cardPlayStrength(a, giruda, jokerPowerless) - cardPlayStrength(b, giruda, jokerPowerless));
  // Prefer dumping a point card if safe (opponent winning anyway)
  const pointDump = dump.find((c) => isPointCard(c));
  const chosen = pointDump ?? dump[0];
  return { cardId: chosen.id, reason: 'dump_low' };
}
