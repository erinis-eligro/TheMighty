import { Card } from '../entities/game.entity';
import {
  isMightyCard,
  isJokerCallCard,
  isJokerCard,
  getMightyCard,
  RANK_STRENGTH,
  JOKER_STRENGTH,
  POWERLESS_JOKER_STRENGTH,
  MIGHTY_STRENGTH,
  GIRUDA_BASE_STRENGTH,
  SUITS,
  RANKS,
  Rank,
  isPointCard,
} from './rules';

/**
 * Pure helpers for what an AI player can work out from PUBLIC information (the cards played so far,
 * the declared friend condition) plus its own hand and role. Nothing here takes another player's hand.
 */

/** A finished (or running) trick as everybody saw it. */
export interface PublicTrick {
  /** Suit to follow; for a joker lead, the suit the leader named. */
  leadSuit?: string;
  cards: { playerId: string; card: Card }[];
  /** Who took the trick; set once it is finished (public). */
  winnerPlayerId?: string;
}

/** Suits a player is known to hold none of (they failed to follow it). */
export type VoidMap = Map<string, Set<string>>;

/** A player who still has to play in the trick, as far as the viewer knows. */
export interface KnownOpponent {
  voids: ReadonlySet<string>;
}

/** With this few lead-suit cards still unseen, somebody behind us is probably out of the suit. */
const LIKELY_VOID_UNSEEN_MAX = 2;

/** Number of cards of one suit in the deck. */
const SUIT_SIZE = RANKS.length;

/** Strength of a card in the trick being played; mirrors `determineTrickWinner`. */
export function trickStrength(
  card: { suit: string; rank: string; isJoker?: boolean },
  giruda: string,
  leadSuit: string | undefined,
  jokerPowerless: boolean
): number {
  if (isMightyCard(card, giruda)) return MIGHTY_STRENGTH;
  if (isJokerCard(card)) return jokerPowerless ? POWERLESS_JOKER_STRENGTH : JOKER_STRENGTH;
  if (card.suit === giruda) return GIRUDA_BASE_STRENGTH + (RANK_STRENGTH[card.rank as Rank] ?? 0);
  if (leadSuit && card.suit === leadSuit) return RANK_STRENGTH[card.rank as Rank] ?? 0;
  return 0;
}

/**
 * Which player failed to follow which suit. The leader never shows a void, and the joker and the
 * mighty are exempt from following, so they prove nothing. A follower's joker-call card proves
 * nothing either: it may have been forced by a joker call, which is not recorded in the trick.
 */
export function findVoidSuits(tricks: PublicTrick[], giruda: string): VoidMap {
  const voids: VoidMap = new Map();
  for (const trick of tricks) {
    const leadSuit = trick.leadSuit;
    if (!leadSuit || trick.cards.length === 0) continue;
    trick.cards.forEach((play, i) => {
      if (i === 0) return;
      const c = play.card;
      if (isJokerCard(c) || isMightyCard(c, giruda) || isJokerCallCard(c, giruda) || c.suit === leadSuit) return;
      const set = voids.get(play.playerId) ?? new Set<string>();
      set.add(leadSuit);
      voids.set(play.playerId, set);
    });
  }
  return voids;
}

/** The 53-card deck minus `seen` (the viewer's hand and every played card). */
export function unseenCards(seen: { suit: string; rank: string; isJoker?: boolean }[], excluded: { suit: string; rank: string }[] = []): Card[] {
  const gone = (c: { suit: string; rank: string; isJoker?: boolean }) =>
    seen.some((s) => (isJokerCard(s) ? isJokerCard(c) : s.suit === c.suit && s.rank === c.rank)) ||
    excluded.some((s) => s.suit === c.suit && s.rank === c.rank);
  const result: Card[] = [];
  for (const suit of SUITS) {
    for (const rank of RANKS) {
      const c: Card = { id: `unseen-${suit}-${rank}`, suit, rank, isJoker: false };
      if (!gone(c)) result.push(c);
    }
  }
  const joker: Card = { id: 'unseen-joker', suit: 'JOKER', rank: '2', isJoker: true };
  if (!gone(joker)) result.push(joker);
  return result;
}

/**
 * Cards the president knows sit with his own team: the declared friend card (or mighty / joker).
 * Only the president gets this; everybody else sees the same declaration but as an opponent's card.
 */
export function cardsHeldByAllies(
  role: string | undefined,
  declaration: { type: string; suit?: string; rank?: string } | null | undefined,
  giruda: string
): { suit: string; rank: string }[] {
  if (role !== 'PRESIDENT' || !declaration) return [];
  if (declaration.type === 'MIGHTY') return [getMightyCard(giruda)];
  if (declaration.type === 'JOKER') return [{ suit: 'JOKER', rank: '2' }];
  if (declaration.type === 'CARD' && declaration.suit && declaration.rank) {
    return [{ suit: declaration.suit, rank: declaration.rank }];
  }
  return [];
}

/** The trick counts as "can be beaten" when the estimated chance of that reaches this. */
export const BEATEN_RISK_THRESHOLD = 0.35;

/**
 * Estimated chance that somebody still to play beats `bestCard`, judged from the cards still unseen.
 * Every unseen card that would win is a threat (a higher lead-suit card, the mighty, a live joker,
 * a giruda that a void player can cut with); a card is held by one of the opponents behind with the
 * probability `opponents * cardsPerOpponent / unseen` (opponents that cannot hold it excluded).
 */
export function trickBeatenRisk({
  bestCard,
  leadSuit,
  giruda,
  jokerPowerless,
  unseen,
  opponents,
  cardsPerOpponent,
}: {
  bestCard: Card;
  leadSuit: string | undefined;
  giruda: string;
  jokerPowerless: boolean;
  unseen: Card[];
  /** Players behind us who are not known to be on our team. */
  opponents: KnownOpponent[];
  /** Cards each of them holds when it plays to this trick. */
  cardsPerOpponent: number;
}): number {
  if (opponents.length === 0 || unseen.length === 0) return 0;
  const best = trickStrength(bestCard, giruda, leadSuit, jokerPowerless);
  if (best >= MIGHTY_STRENGTH) return 0;

  const unseenLead = leadSuit
    ? unseen.filter((c) => c.suit === leadSuit && !isJokerCard(c) && !isMightyCard(c, giruda)).length
    : 0;
  const cutters = opponents.filter(
    (o) =>
      !!leadSuit &&
      leadSuit !== giruda &&
      !o.voids.has(giruda) &&
      (o.voids.has(leadSuit) || unseenLead <= LIKELY_VOID_UNSEEN_MAX)
  ).length;

  let safe = 1;
  for (const u of unseen) {
    if (trickStrength(u, giruda, leadSuit, jokerPowerless) <= best) continue;
    let holders: number;
    if (isMightyCard(u, giruda) || isJokerCard(u)) {
      holders = opponents.length;
    } else if (u.suit === giruda && leadSuit !== giruda) {
      holders = cutters;
    } else {
      holders = opponents.filter((o) => !o.voids.has(u.suit)).length;
    }
    safe *= 1 - Math.min(1, (holders * cardsPerOpponent) / unseen.length);
  }
  return 1 - safe;
}

export function canTrickBeBeaten(params: Parameters<typeof trickBeatenRisk>[0]): boolean {
  return trickBeatenRisk(params) >= BEATEN_RISK_THRESHOLD;
}

/**
 * Estimated number of giruda cards that may still be in an opponent's hand:
 * 13 - (played) - (own hand) - (cards known to be with allies). Opponents who are known to be void in
 * the giruda do not count; with every opponent void the answer is 0. Allies' unknown giruda are not
 * subtracted, so the estimate errs on the side of "the opposition still has trumps".
 */
export function estimateOppositionGiruda({
  hand,
  played,
  giruda,
  allyCards = [],
  opponents,
}: {
  hand: Card[];
  played: Card[];
  giruda: string;
  allyCards?: { suit: string; rank: string }[];
  opponents: KnownOpponent[];
}): number {
  if (giruda === 'NO_GIRUDA') return 0;
  if (opponents.length > 0 && opponents.every((o) => o.voids.has(giruda))) return 0;
  const seen = new Set<string>();
  for (const c of [...hand, ...played]) if (c.suit === giruda && !isJokerCard(c)) seen.add(c.rank);
  const allyHeld = allyCards.filter((c) => c.suit === giruda && !seen.has(c.rank)).length;
  return Math.max(0, SUIT_SIZE - seen.size - allyHeld);
}

/** A player still to play in the trick, as seen by an opposition viewer. */
export interface TrickSeat {
  /** Chance (0..1) that this player is on the owner team. */
  ownerTeamProb: number;
  voids: ReadonlySet<string>;
}

/**
 * Chance that `otherId` is on the owner team, from an OPPOSITION viewer's point of view and public
 * information only. The president is public; after the reveal the viewer's known allies are the whole
 * opposition (everybody else is owner team). Before it, the friend is one of the other three
 * non-president players unless no friend was declared, so each of them is the friend with 1/3.
 */
export function ownerTeamProbability({
  otherId,
  ownerPlayerId,
  friendRevealed,
  knownAllyIds,
  friendDeclaration,
}: {
  otherId: string;
  ownerPlayerId: string;
  friendRevealed: boolean;
  knownAllyIds: readonly string[];
  friendDeclaration?: { type: string } | null;
}): number {
  if (otherId === ownerPlayerId) return 1;
  if (friendRevealed) return knownAllyIds.includes(otherId) ? 0 : 1;
  return friendDeclaration?.type === 'NO_FRIEND' ? 0 : 1 / 3;
}

/**
 * Who is likely to take the trick, as the chance that the owner team does (the rest is the opposition).
 * The best card so far belongs to the owner team with `bestOwnerTeamProb`. Every player still to play
 * turns the trick over with his own chance (`trickBeatenRisk` with him alone); that is a threat to the
 * team he is NOT on, so a seat on the owner team with probability q threatens an opposition card with
 * q * risk and an owner-team card with (1 - q) * risk. With nobody behind the current best simply wins.
 */
export function ownerTeamTrickChance({
  bestCard,
  bestOwnerTeamProb,
  leadSuit,
  giruda,
  jokerPowerless,
  unseen,
  behind,
  cardsPerOpponent,
}: {
  bestCard: Card;
  bestOwnerTeamProb: number;
  leadSuit: string | undefined;
  giruda: string;
  jokerPowerless: boolean;
  unseen: Card[];
  behind: TrickSeat[];
  cardsPerOpponent: number;
}): number {
  let ownerKeeps = 1;
  let ownerGains = 1;
  for (const seat of behind) {
    const risk = trickBeatenRisk({
      bestCard,
      leadSuit,
      giruda,
      jokerPowerless,
      unseen,
      opponents: [{ voids: seat.voids }],
      cardsPerOpponent,
    });
    ownerKeeps *= 1 - (1 - seat.ownerTeamProb) * risk;
    ownerGains *= 1 - seat.ownerTeamProb * risk;
  }
  return bestOwnerTeamProb * ownerKeeps + (1 - bestOwnerTeamProb) * (1 - ownerGains);
}

/** Score cards in finished tricks that somebody other than `playerId` took (public). */
export function pointsNotWonBy(tricks: PublicTrick[], playerId: string): number {
  return tricks
    .filter((t) => t.winnerPlayerId !== undefined && t.winnerPlayerId !== playerId)
    .reduce((sum, t) => sum + t.cards.filter((p) => isPointCard(p.card)).length, 0);
}

/** Finished tricks the owner took in which `playerId` put in a score card (public). */
export function pointCardsGivenToOwner(tricks: PublicTrick[], playerId: string, ownerPlayerId: string): number {
  return tricks.filter(
    (t) =>
      t.winnerPlayerId === ownerPlayerId &&
      t.cards.some((p) => p.playerId === playerId && isPointCard(p.card))
  ).length;
}
