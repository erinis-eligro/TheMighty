import { SeatPosition } from '../constants';
import type { GameEngine } from '../core/game-engine';

export interface Card {
  suit: 'SPADE' | 'DIAMOND' | 'HEART' | 'CLUB' | 'JOKER';
  rank: '2' | '3' | '4' | '5' | '6' | '7' | '8' | '9' | '10' | 'J' | 'Q' | 'K' | 'A';
  isJoker: boolean;
  id: string;
}

export type Suit = 'SPADE' | 'DIAMOND' | 'HEART' | 'CLUB';

/** Trump (기루다) declared in a bid; `NO_GIRUDA` means no trump suit. */
export type BidGiruda = Suit | 'NO_GIRUDA';

export interface Bid {
  /** Seat index of the bidder in GameState.players. */
  bidderIndex: number;
  /** 13 ~ 20. */
  score: number;
  giruda: BidGiruda;
}

export type GamePhase =
  | 'READY'
  | 'DEALING'
  | 'BIDDING'
  | 'KITTY_EXCHANGE'
  | 'FRIEND_SELECTION'
  | 'TRICK_PLAYING'
  | 'TRICK_RESOLVED'
  | 'ROUND_SCORING'
  | 'GAME_OVER';

export interface Player {
  id: string;
  socketId: string;
  username: string;
  seat: SeatPosition;
  hand: Card[];
  isReady: boolean;
  isAi: boolean;
  bid?: number;
  /** True once the player has passed in the current bidding; passed players cannot bid again. */
  hasPassed?: boolean;
  /** Score (point) cards (10, J, Q, K, A) won by this player in resolved tricks. */
  collectedScoreCards: Card[];
  /** Number of score cards collected so far (== collectedScoreCards.length). */
  score: number;
  isFriend: boolean;
  isOwner: boolean;
}

export interface TrickCard {
  playerId: string;
  /** Seat index of the player in GameState.players. */
  playerIndex: number;
  card: Card;
}

export interface Trick {
  id: string;
  trickNumber: number;
  cards: TrickCard[];
  leadSuit?: Suit;
  winnerPlayerId?: string;
  winnerIndex?: number;
}

export type FriendDeclaration =
  | { type: 'NO_FRIEND' }
  | { type: 'FIRST_TRICK' }
  | { type: 'MIGHTY' }
  | { type: 'JOKER' }
  | { type: 'CARD'; suit: Suit; rank: Card['rank'] };

/** Role of a player in a finished round. Values match the Prisma `Role` enum. */
export type PlayerRole = 'OWNER' | 'FRIEND' | 'OPPOSER';

export interface PlayerRoundScore {
  playerId: string;
  role: PlayerRole;
  /** Score cards (10, J, Q, K, A) this player collected. */
  points: number;
}

/** Outcome of ROUND_SCORING, computed by the engine once all tricks are resolved. */
export interface RoundResult {
  isWin: boolean;
  bidScore: number;
  giruda: Suit | 'NO_GIRUDA';
  /** Score cards collected by the owner team (president + friend). */
  teamPoints: number;
  /** Score cards collected by the opposition. */
  opponentPoints: number;
  ownerPlayerId: string;
  /** Null for no-friend (or when the president is his own friend). */
  friendPlayerId: string | null;
  players: PlayerRoundScore[];
}

export interface GameState {
  roomId: string;
  phase: GamePhase;
  /** Source of truth for whose turn it is (index into `players`). */
  currentTurnIndex: number;
  /** Mirror of `players[currentTurnIndex].id`, kept in sync by the engine. */
  turnPlayerId: string;
  currentTrick: Trick | null;
  trickHistory: Trick[];
  /** 1-based number of the trick being played (0 before trick play starts). */
  currentTrickNumber: number;
  leadSuit: Suit | null;
  isJokerCallActive: boolean;
  kitty: Card[];
  giruda: Suit | 'NO_GIRUDA';
  /** Id of the president (주공). Empty until bidding completes; independent of the room host. */
  ownerPlayerId: string;
  /** Index of the bid winner (president / 주공); null until bidding completes. */
  presidentIndex: number | null;
  friendDeclaration: FriendDeclaration | null;
  /** Index of the friend; null until revealed/assigned. */
  friendIndex: number | null;
  friendPlayerId?: string;
  /**
   * True once the friend question is settled for all players: the friend was
   * revealed, or the president plays without one (NO_FRIEND, the president
   * holds the card, ...). Until then `friendIndex`/`friendPlayerId` stay empty.
   */
  friendRevealed: boolean;
  /** Number of players who have passed in the current bidding. */
  passCount: number;
  /** Score of the highest bid so far (0 if none); mirrors `highestBid.score`. */
  currentBid: number;
  /** Highest bid so far (score + giruda), or null if nobody has bid. */
  highestBid: Bid | null;
  bidLeader?: string;
  players: Player[];
  /** Set by ROUND_SCORING; null while the game is in progress. */
  result?: RoundResult | null;
}

/**
 * One single-player game session (1 human + 4 AI). Owned by GameService; the gateway only
 * talks to the client and drives the timers stored here.
 */
export interface GameSession {
  id: string;
  engine: GameEngine;
  humanPlayerId: string;
  /** Nickname of the human; used for the stats record. */
  username: string;
  /** Secret handed out only to the creating socket; required to rebind a new socket (rejoin). */
  rejoinToken: string;
  /** Socket currently bound to the human seat; undefined while disconnected. */
  humanSocketId?: string;
  aiTimers: Map<string, NodeJS.Timeout>;
  /** True once game_end was sent and the result was persisted (guards against double saves). */
  finished?: boolean;
  /** Fires after TRICK_RESOLVED_DELAY_MS to start the next trick / finish the game. */
  resolveTimer?: NodeJS.Timeout;
  /** Consecutive failed AI steps; the driver gives up after MAX_AI_FAILURES instead of looping on an error. */
  aiFailures?: number;
  /** Deletes the session if the human does not come back within SESSION_TTL_MS after a disconnect. */
  expiryTimer?: NodeJS.Timeout;
  createdAt: Date;
}
