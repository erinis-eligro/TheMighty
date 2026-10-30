import { Card, Bid, BidGiruda, FriendDeclaration } from '../entities/game.entity';
import {
  getMightyCard,
  isMightyCard,
  isJokerCard,
  isJokerCallCard,
  isJokerPowerless,
  isPointCard,
  RANK_STRENGTH,
  JOKER_STRENGTH,
  POWERLESS_JOKER_STRENGTH,
  MIGHTY_STRENGTH,
  GIRUDA_BASE_STRENGTH,
  MIN_BID,
  MAX_BID,
  KITTY_SIZE,
  Suit,
  SUITS,
  RANKS,
  POINT_RANKS,
  Rank,
} from './rules';
import { validatePlay } from './trick';
import { validateBid, lowestValidScore } from './bidding';
import {
  BEATEN_RISK_THRESHOLD,
  KnownOpponent,
  PublicTrick,
  trickBeatenRisk,
  cardsHeldByAllies,
  estimateOppositionGiruda,
  findVoidSuits,
  trickStrength,
  unseenCards,
} from './ai-knowledge';

/**
 * Information boundary of the AI: every function in this file receives only the player's OWN hand,
 * public information (played cards, void suits derived from them, the declared friend condition)
 * and the player's OWN role / the allies that role lets it know. No API here takes another player's
 * hand, and none may be added: the AI must never play as if it saw hidden cards.
 */

export interface AiBidDecision {
  /** null = pass */
  bid: number | null;
  /** Declared giruda; null when passing. */
  giruda: BidGiruda | null;
  reason: string;
}

/** What the AI knows about its own side. Friends stay hidden, so this is the player's private knowledge. */
export type AiTeamRole = 'PRESIDENT' | 'FRIEND' | 'OPPOSITION';

export interface AiPlayDecision {
  cardId: string;
  reason: string;
  /** The leader declares the joker call with this play. */
  jokerCall?: boolean;
  /** Suit named when leading with the joker. */
  jokerLeadSuit?: string;
}

/** Score cards a hand is assumed to win before its own cards are counted (the friend's help and luck). */
const BASE_ESTIMATE = 7;

/** A friend holding the declared mighty leads it from this trick on (it reveals the friend while the president can still plan). */
const FRIEND_MIGHTY_LEAD_FROM = 5;

/** Cards this close in dump value are treated as equal, so the choice between them can vary. */
const DUMP_BAND = 1;

/** Lead candidates this close in value are treated as equal. */
const LEAD_BAND = 2;

/** The partner's trick is fed when the chance of it being beaten stays under this (lower with points on the table). */
const RISK_LIMIT_PER_POINT = 0.05;
const MIN_RISK_LIMIT = 0.1;

/** The owner team drains the opposition's giruda while at least this many may be left. */
const DRAIN_MIN_GIRUDA = 1;

/** A giruda lead is only worth it with at most this many higher giruda still out. */
const DRAIN_MAX_HIGHER_UNSEEN = 1;

/** Estimate handicap of a no-giruda bid compared with a suited one. */
const NO_GIRUDA_PENALTY = 1.5;

const AI_NAMES = ['AI 동서', 'AI 남서', 'AI 북서', 'AI 북동'];

export function generateAiName(index: number): string {
  return AI_NAMES[index] ?? `AI ${index + 1}`;
}

function suitLength(hand: Card[], suit: string): number {
  return hand.filter((c) => c.suit === suit && !isJokerCard(c)).length;
}

/**
 * Rough number of score cards the president's team can expect with `giruda`
 * (friend help included). Used to decide the bid; it is a heuristic, not a promise.
 */
export function estimateHandScore(hand: Card[], giruda: BidGiruda): number {
  const noGiruda = giruda === 'NO_GIRUDA';
  const girudaValue: Partial<Record<Rank, number>> = { A: 2, K: 1.6, Q: 1.3, J: 1.1, '10': 0.9, '9': 0.7 };
  const offSuitValue: Partial<Record<Rank, number>> = noGiruda
    ? { A: 1.8, K: 1.2, Q: 0.7, J: 0.4 }
    : { A: 1.2, K: 0.7, Q: 0.3 };

  let estimate = BASE_ESTIMATE;
  const girudaCount = noGiruda ? 0 : suitLength(hand, giruda);
  for (const c of hand) {
    if (isJokerCard(c)) {
      estimate += 2;
    } else if (isMightyCard(c, giruda)) {
      estimate += 2;
    } else if (c.suit === giruda) {
      estimate += girudaValue[c.rank as Rank] ?? 0.5;
    } else {
      estimate += offSuitValue[c.rank as Rank] ?? 0;
    }
  }
  // Short side suits can be trumped once the giruda is long enough.
  if (girudaCount >= 4) {
    for (const s of SUITS) {
      if (s !== giruda && suitLength(hand, s) <= 1) estimate += 0.5;
    }
  }
  return estimate;
}

/**
 * Bid decision. The giruda candidates are the longest suit(s) of the hand plus no-giruda;
 * the AI bids the lowest legal score when its estimate reaches it, never above MAX_BID.
 */
export function selectBid({
  hand,
  currentBid,
}: {
  hand: Card[];
  currentBid: Bid | null;
}): AiBidDecision {
  const longest = Math.max(...SUITS.map((s) => suitLength(hand, s)));
  const candidates: { giruda: BidGiruda; estimate: number }[] = SUITS.filter(
    (s) => suitLength(hand, s) === longest
  ).map((s) => ({ giruda: s as BidGiruda, estimate: estimateHandScore(hand, s) }));
  // No-giruda has no trump to fall back on, so it must clearly beat the suited estimate.
  candidates.push({ giruda: 'NO_GIRUDA', estimate: estimateHandScore(hand, 'NO_GIRUDA') - NO_GIRUDA_PENALTY });
  const best = candidates.reduce((a, b) => (b.estimate > a.estimate ? b : a));

  const wanted = Math.min(MAX_BID, Math.floor(best.estimate));
  if (wanted < MIN_BID) {
    return { bid: null, giruda: null, reason: 'pass' };
  }

  const lowest = lowestValidScore(best.giruda, currentBid);
  if (lowest === null || lowest > wanted) {
    return { bid: null, giruda: null, reason: lowest === null ? 'cannot_outbid' : 'pass' };
  }
  if (!validateBid({ score: lowest, giruda: best.giruda, currentBid }).valid) {
    return { bid: null, giruda: null, reason: 'pass' };
  }
  return {
    bid: lowest,
    giruda: best.giruda,
    reason: best.giruda === 'NO_GIRUDA' ? 'bid_no_giruda' : 'bid_longest_suit',
  };
}

/**
 * Picks the 3 cards the AI president discards from its 13 cards (hand + kitty).
 * Never the joker or the mighty; giruda cards and point cards are kept when possible, and
 * cards of short side suits go first so a suit can be emptied (and later trumped).
 * The giruda is kept as bid.
 */
export function selectKittyDiscard({
  cards,
  giruda,
}: {
  cards: Card[];
  giruda: string;
}): { discardCardIds: string[] } {
  const hasJoker = cards.some((c) => isJokerCard(c));
  const keepValue = (c: Card): number => {
    if (isJokerCard(c) || isMightyCard(c, giruda)) return 1000;
    let value = baseStrength(c, giruda) + (isPointCard(c) ? 30 : 0);
    if (c.suit !== giruda) value += suitLength(cards, c.suit) * 3;
    // Without the joker the joker-call card is worth keeping.
    if (!hasJoker && isJokerCallCard(c, giruda)) value += 8;
    return value;
  };
  const discardCardIds = [...cards]
    .sort((a, b) => keepValue(a) - keepValue(b))
    .slice(0, KITTY_SIZE)
    .map((c) => c.id);
  return { discardCardIds };
}

/** Strength of a card outside of any trick: giruda above the rest, rank within a suit. */
function baseStrength(card: Card, giruda: string): number {
  if (card.suit === giruda) return GIRUDA_BASE_STRENGTH + (RANK_STRENGTH[card.rank as Rank] ?? 0);
  return RANK_STRENGTH[card.rank as Rank] ?? 0;
}

/** Order for getting rid of cards: the lowest value goes first. Joker and mighty are never thrown away. */
function dumpValue(card: Card, giruda: string): number {
  if (isJokerCard(card) || isMightyCard(card, giruda)) return 1000;
  return baseStrength(card, giruda) + (isPointCard(card) ? 30 : 0);
}

/**
 * True when no unseen card can beat `card` inside its own suit (everything higher was played or
 * is in the AI's hand). It can still be trumped by a void player.
 */
function isMasterOfSuit(card: Card, hand: Card[], played: Card[]): boolean {
  if (isJokerCard(card)) return false;
  const higher = RANKS.filter((r) => RANK_STRENGTH[r] > RANK_STRENGTH[card.rank as Rank]);
  return higher.every((r) => [...hand, ...played].some((c) => c.suit === card.suit && c.rank === r));
}

/**
 * Suit named when leading with the joker: the suit with the most score cards still out
 * (not in the AI's hand, not played), so the followers have to hand them over.
 * Ties: a non-giruda suit, then SUITS order.
 */
function pickJokerLeadSuit(hand: Card[], giruda = 'NO_GIRUDA', played: Card[] = [], avoidGiruda = false): string {
  const seen = [...hand, ...played];
  const outstanding = (suit: string) =>
    POINT_RANKS.filter((r) => !seen.some((c) => c.suit === suit && c.rank === r)).length;
  const suits = SUITS.filter((s) => !(avoidGiruda && s === giruda));
  return suits.reduce((best, s) => {
    const diff = outstanding(s) - outstanding(best);
    if (diff !== 0) return diff > 0 ? s : best;
    if (best === giruda && s !== giruda) return s;
    return best;
  }, suits[0] as string);
}

/** Cards whose value is within `band` of the best one (`sorted` is best first); one is picked with `rng`. */
function pickAmong(sorted: Card[], value: (c: Card) => number, band: number, rng: () => number): Card {
  const top = value(sorted[0]);
  const pool = sorted.filter((c) => Math.abs(value(c) - top) <= band);
  return pool[Math.min(pool.length - 1, Math.floor(rng() * pool.length))];
}

/** Number of unseen cards of the card's suit that rank above it. */
function higherUnseenInSuit(card: Card, hand: Card[], played: Card[]): number {
  const strength = RANK_STRENGTH[card.rank as Rank];
  return RANKS.filter(
    (r) =>
      RANK_STRENGTH[r] > strength && ![...hand, ...played].some((c) => c.suit === card.suit && c.rank === r)
  ).length;
}

/**
 * Whether the leader should declare the joker call: only when it does not hold the joker
 * and the joker is still out, and is probably not on its own team. The president who called
 * the joker as friend knows the joker sits with his friend, so he keeps it powerful.
 */
function shouldDeclareJokerCall(hand: Card[], playedCards: Card[], context: AiPlayContext): boolean {
  if (hand.some((c) => isJokerCard(c))) return false;
  if (playedCards.some((c) => isJokerCard(c))) return false;
  if (context.role === 'PRESIDENT' && context.friendDeclaration?.type === 'JOKER') return false;
  return true;
}

/** What the AI may know beyond its hand: all of it is public or about its own role. */
export interface AiPlayContext {
  role?: AiTeamRole;
  /** Cards of finished tricks plus the current one (public). Used for card counting. */
  playedCards?: Card[];
  /** The declared friend condition (public). */
  friendDeclaration?: FriendDeclaration | null;
  /** The friend was revealed (public). */
  friendRevealed?: boolean;
  /** Finished tricks plus the current one with their lead suit (public). Used to track void suits. */
  tricks?: PublicTrick[];
  /** Players still to play after this one in the current trick (everybody else when leading). */
  playersBehind?: string[];
  /** Players this one knows are on its team (see `isAlly`); never includes a hidden friend. */
  knownAllyIds?: string[];
  /** Random source for choosing between equal options; inject a seeded one in tests. */
  rng?: () => number;
}

/** Players behind us who are not known allies, with the suits they are known to be out of. */
function opponentsBehind(context: AiPlayContext, voids: Map<string, Set<string>>, playsSoFar: number): KnownOpponent[] {
  const none = new Set<string>();
  if (!context.playersBehind) {
    // Unknown seating: assume everybody still to play is an opponent without known voids.
    return Array.from({ length: Math.max(0, 4 - playsSoFar) }, () => ({ voids: none }));
  }
  const allies = new Set(context.knownAllyIds ?? []);
  return context.playersBehind.filter((id) => !allies.has(id)).map((id) => ({ voids: voids.get(id) ?? none }));
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
  restrictGirudaLead,
  isJokerCallActive = false,
  context = {},
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
  restrictGirudaLead?: boolean;
  /** The joker call was already declared in the current trick. */
  isJokerCallActive?: boolean;
  context?: AiPlayContext;
}): AiPlayDecision {
  const isLeading = currentTrickPlays.length === 0;
  const jokerPowerless = isJokerPowerless({ trickNumber, totalTricks, isJokerCallActive });
  const playedCards = context.playedCards ?? [];
  const role = context.role;
  const rng = context.rng ?? Math.random;
  const strengthOf = (c: Card) => trickStrength(c, giruda, leadSuit, jokerPowerless);

  // Public knowledge: who failed to follow which suit, who is still to play, and what is left unseen.
  const voids = findVoidSuits(context.tricks ?? [], giruda);
  const opponents = opponentsBehind(context, voids, currentTrickPlays.length);
  const allyCards = cardsHeldByAllies(role, context.friendDeclaration, giruda);
  const unseen = unseenCards([...hand, ...playedCards], allyCards);
  const mightyOut = unseen.some((c) => isMightyCard(c, giruda));
  const girudaLeft = estimateOppositionGiruda({ hand, played: playedCards, giruda, allyCards, opponents });
  // The opposition cannot tell the teams before the friend is revealed, so it never counts a partner then.
  const partnerKnown = isPartnerWinningCurrentTrick && !(role === 'OPPOSITION' && !context.friendRevealed);
  const jokerLeadSuit = (avoidGiruda = false) => pickJokerLeadSuit(hand, giruda, playedCards, avoidGiruda);

  const valid = hand.filter((c) => {
    const v = validatePlay({
      card: c,
      hand,
      leadSuit,
      isLeading,
      trickNumber,
      totalTricks,
      giruda,
      restrictGirudaLead,
      isJokerCallActive,
      jokerLeadSuit: isLeading && isJokerCard(c) ? jokerLeadSuit() : undefined,
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

  // Leader holding the joker-call card calls the joker in the middle tricks while the joker is out.
  if (
    isLeading &&
    jokerCallCard &&
    trickNumber > 1 &&
    trickNumber < totalTricks &&
    shouldDeclareJokerCall(hand, playedCards, context)
  ) {
    const call = valid.find((c) => isJokerCallCard(c, giruda));
    if (call) {
      return { cardId: call.id, reason: 'declare_joker_call', jokerCall: true };
    }
  }

  // The joker is powerless in the last trick, so it must be played in the one before.
  const joker = valid.find((c) => isJokerCard(c));
  if (joker && !jokerPowerless && trickNumber === totalTricks - 1) {
    return isLeading
      ? { cardId: joker.id, reason: 'joker_before_last', jokerLeadSuit: jokerLeadSuit() }
      : { cardId: joker.id, reason: 'joker_before_last' };
  }

  if (isLeading) {
    return selectLeadCard({
      hand,
      valid,
      giruda,
      trickNumber,
      totalTricks,
      playedCards,
      role,
      joker,
      jokerLeadSuit,
      opponents,
      girudaLeft,
      mightyOut,
      friendDeclaration: context.friendDeclaration,
      friendRevealed: context.friendRevealed,
      rng,
    });
  }

  // Following: who is winning, and can we beat it?
  const currentBest = currentTrickPlays.reduce<{ playerId: string; strength: number; card: Card }>(
    (best, p) => {
      const s = strengthOf(p.card);
      return s > best.strength ? { playerId: p.playerId, strength: s, card: p.card } : best;
    },
    { playerId: '', strength: -1, card: currentTrickPlays[0].card }
  );
  const pointsOnTable = currentTrickPlays.filter((p) => isPointCard(p.card)).length;
  const byDump = (a: Card, b: Card) => dumpValue(a, giruda) - dumpValue(b, giruda);

  const byRandomDump = (cards: Card[]) => {
    const sorted = [...cards].sort(byDump);
    return pickAmong(sorted, (c) => dumpValue(c, giruda), DUMP_BAND, rng);
  };

  if (partnerKnown) {
    // The trick is safe when the partner holds the mighty or nobody plays after us.
    const secure = isMightyCard(currentBest.card, giruda) || currentTrickPlays.length === 4;
    const feedable = valid.filter(
      (c) => isPointCard(c) && !isJokerCard(c) && !isMightyCard(c, giruda) && !isJokerCallCard(c, giruda)
    );
    if (secure) {
      if (feedable.length > 0) return { cardId: pickAmong([...feedable].sort(byDump), (c) => dumpValue(c, giruda), 0, rng).id, reason: 'feed_partner' };
    } else {
      // Nobody is sure: judge from the unseen cards, the voids and what the trick already holds.
      const risk = trickBeatenRisk({
        bestCard: currentBest.card,
        leadSuit,
        giruda,
        jokerPowerless,
        unseen,
        opponents,
        cardsPerOpponent: hand.length,
      });
      const limit = Math.max(MIN_RISK_LIMIT, BEATEN_RISK_THRESHOLD - RISK_LIMIT_PER_POINT * pointsOnTable);
      if (risk < limit) {
        if (feedable.length > 0) return { cardId: pickAmong([...feedable].sort(byDump), (c) => dumpValue(c, giruda), 0, rng).id, reason: 'feed_partner' };
      } else if (role !== 'OPPOSITION' && pointsOnTable > 0) {
        // The owner team does not leave a trick with points to a coin flip: take it over itself.
        const takeOver = valid.filter((c) => strengthOf(c) > currentBest.strength).sort((a, b) => strengthOf(a) - strengthOf(b));
        if (takeOver.length > 0) return { cardId: takeOver[0].id, reason: 'secure_partner_trick' };
      }
    }
    return { cardId: byRandomDump(valid).id, reason: 'partner_winning_dump' };
  }

  const winners = valid.filter((c) => strengthOf(c) > currentBest.strength).sort((a, b) => strengthOf(a) - strengthOf(b));
  if (winners.length > 0) {
    const cheapest = winners[0];
    // Spending the mighty, the joker or a trump on a trick without points is a waste early on.
    const expensive =
      isMightyCard(cheapest, giruda) ||
      isJokerCard(cheapest) ||
      (cheapest.suit === giruda && leadSuit !== giruda);
    const worthIt = !expensive || pointsOnTable > 0 || trickNumber >= totalTricks - 1;
    if (worthIt) {
      return { cardId: cheapest.id, reason: 'win_cheaply' };
    }
  }

  // Cannot (or should not) win: give away the least, and never points to the other team.
  return { cardId: byRandomDump(valid).id, reason: 'dump_low' };
}

function selectLeadCard({
  hand,
  valid,
  giruda,
  trickNumber,
  totalTricks,
  playedCards,
  role,
  joker,
  jokerLeadSuit,
  opponents,
  girudaLeft,
  mightyOut,
  friendDeclaration,
  friendRevealed,
  rng,
}: {
  hand: Card[];
  valid: Card[];
  giruda: string;
  trickNumber: number;
  totalTricks: number;
  playedCards: Card[];
  role?: AiTeamRole;
  joker?: Card;
  jokerLeadSuit: (avoidGiruda?: boolean) => string;
  opponents: KnownOpponent[];
  /** Estimated giruda cards still with the opposition. */
  girudaLeft: number;
  /** The mighty may still be in an opponent's hand (not played, not mine, not an ally's known card). */
  mightyOut: boolean;
  friendDeclaration?: FriendDeclaration | null;
  friendRevealed?: boolean;
  rng: () => number;
}): AiPlayDecision {
  const mightyCard = hand.find((c) => isMightyCard(c, giruda));
  const ownerTeam = role === 'PRESIDENT' || role === 'FRIEND';
  const midGame = trickNumber > 1 && trickNumber < totalTricks;

  // Owner team: the opposition's giruda is the biggest unknown, so draw it out before anything else.
  // (No giruda: nothing to draw; first trick: the president may not lead giruda.)
  const drainGiruda = ownerTeam && giruda !== 'NO_GIRUDA' && girudaLeft >= DRAIN_MIN_GIRUDA;
  if (drainGiruda && midGame) {
    // One joker draws the trumps out and keeps the lead (it is powerless in the first and last trick).
    if (joker && !mightyOut) {
      return { cardId: joker.id, reason: 'drain_giruda_joker', jokerLeadSuit: giruda };
    }
    const trumps = valid
      .filter((c) => c.suit === giruda && !isJokerCard(c) && !isMightyCard(c, giruda))
      .sort((a, b) => baseStrength(b, giruda) - baseStrength(a, giruda));
    // A weak trump would only hand the opposition points, so lead it only when few higher ones remain.
    if (trumps.length > 0 && higherUnseenInSuit(trumps[0], hand, playedCards) <= DRAIN_MAX_HIGHER_UNSEEN) {
      return { cardId: trumps[0].id, reason: 'drain_giruda' };
    }
  }

  // With nothing able to beat it, the joker wins its trick: lead it in the middle game.
  // Once the opposition has no giruda left it is kept for the points and the late game.
  const keepJoker = ownerTeam && giruda !== 'NO_GIRUDA' && girudaLeft === 0 && trickNumber < totalTricks - 2;
  if (joker && !mightyOut && trickNumber > 1 && trickNumber < totalTricks - 1 && !keepJoker) {
    return { cardId: joker.id, reason: 'lead_joker', jokerLeadSuit: jokerLeadSuit() };
  }

  const plain = valid.filter((c) => !isJokerCard(c) && !isMightyCard(c, giruda));

  // A side-suit card nobody can beat (except by trumping) collects the trick.
  // With nothing left to cut it, it also keeps the lead for the next trick.
  const masters = plain
    .filter((c) => c.suit !== giruda && isMasterOfSuit(c, hand, playedCards))
    .sort((a, b) => baseStrength(b, giruda) - baseStrength(a, giruda));
  if (masters.length > 0) {
    return { cardId: pickAmong(masters, (c) => baseStrength(c, giruda), 0, rng).id, reason: 'lead_master' };
  }

  // A friend holding the declared mighty shows it earlier than the end game, so the president can plan around it.
  const revealsFriend = role === 'FRIEND' && !friendRevealed && friendDeclaration?.type === 'MIGHTY';
  if (mightyCard && revealsFriend && midGame && trickNumber >= FRIEND_MIGHTY_LEAD_FROM && valid.includes(mightyCard)) {
    return { cardId: mightyCard.id, reason: 'lead_mighty_reveal' };
  }
  // Otherwise the mighty is saved for the end unless nothing else can be led.
  const early = trickNumber < totalTricks - 2;
  let pool = early && plain.length > 0 ? plain : valid;
  // The opposition keeps its trumps for cutting; the president's side draws the trumps out.
  if (role === 'OPPOSITION') {
    const offSuit = pool.filter((c) => c.suit !== giruda || isJokerCard(c) || isMightyCard(c, giruda));
    if (offSuit.length > 0) pool = offSuit;
  }
  const nonPoint = pool.filter((c) => !isPointCard(c));
  const candidates = [...(nonPoint.length > 0 ? nonPoint : pool)].sort(
    (a, b) => dumpValue(b, giruda) - dumpValue(a, giruda)
  );
  // The joker/mighty sort first by value, so skip them while a normal card is available.
  const normal = candidates.filter((c) => !isJokerCard(c) && !isMightyCard(c, giruda));
  const chosen = normal.length > 0 ? pickAmong(normal, (c) => dumpValue(c, giruda), LEAD_BAND, rng) : candidates[0];
  if (isJokerCard(chosen)) {
    return { cardId: chosen.id, reason: 'lead_safe', jokerLeadSuit: jokerLeadSuit() };
  }
  return { cardId: chosen.id, reason: 'lead_safe' };
}

/**
 * AI president's friend choice: the mighty, then the joker, then the giruda ace/king, whichever
 * the AI does not hold itself and did not discard; no friend when it holds them all.
 * With no giruda the aces of the side suits are called after the mighty and the joker.
 */
export function selectFriendDeclaration({
  hand,
  giruda,
  discarded = [],
}: {
  hand: Card[];
  giruda: string;
  /** The 3 cards the president discarded: nobody holds them, so calling one is pointless. */
  discarded?: Card[];
}): FriendDeclaration {
  const unavailable = (suit: string, rank: string) =>
    [...hand, ...discarded].some((c) => c.suit === suit && c.rank === rank);
  const mighty = getMightyCard(giruda);
  if (!unavailable(mighty.suit, mighty.rank)) return { type: 'MIGHTY' };
  if (![...hand, ...discarded].some((c) => isJokerCard(c))) return { type: 'JOKER' };

  const suits = giruda === 'NO_GIRUDA' ? SUITS : [giruda as Suit];
  for (const rank of ['A', 'K'] as const) {
    for (const suit of suits) {
      if (!unavailable(suit, rank) && !(suit === mighty.suit && rank === mighty.rank)) {
        return { type: 'CARD', suit, rank };
      }
    }
    // No giruda: only aces are worth calling.
    if (giruda === 'NO_GIRUDA') break;
  }
  return { type: 'NO_FRIEND' };
}
