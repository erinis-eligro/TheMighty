import { SeatPosition } from '../constants';

export interface Card {
  suit: 'SPADE' | 'DIAMOND' | 'HEART' | 'CLUB' | 'JOKER';
  rank: '3' | '4' | '5' | '6' | '7' | '8' | '9' | '10' | 'J' | 'Q' | 'K' | 'A' | '2';
  isJoker: boolean;
  id: string;
}

export type Suit = 'SPADE' | 'DIAMOND' | 'HEART' | 'CLUB';

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
  ownerPlayerId: string;
  /** Index of the bid winner (president / 주공); null until a bid is placed. */
  presidentIndex: number | null;
  friendDeclaration: FriendDeclaration | null;
  /** Index of the friend; null until revealed/assigned. */
  friendIndex: number | null;
  friendPlayerId?: string;
  /** Consecutive passes in the current bidding round. */
  passCount: number;
  currentBid: number;
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
