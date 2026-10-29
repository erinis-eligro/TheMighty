import { SeatPosition } from '../constants';

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
}

export interface Room {
  id: string;
  hostId: string;
  players: Map<string, Player>;
  gameState: GameState | null;
  createdAt: Date;
}
