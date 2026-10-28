import { SeatPosition } from '../constants';

export interface Card {
  suit: 'SPADE' | 'DIAMOND' | 'HEART' | 'CLUB' | 'JOKER';
  rank: '2' | '3' | '4' | '5' | '6' | '7' | '8' | '9' | '10' | 'J' | 'Q' | 'K' | 'A';
  isJoker: boolean;
  id: string;
}

export interface Player {
  id: string;
  socketId: string;
  username: string;
  seat: SeatPosition;
  hand: Card[];
  isReady: boolean;
  isAi: boolean;
  bid?: number;
  trickScore: number;
  isFriend: boolean;
  isOwner: boolean;
}

export interface Trick {
  id: string;
  cards: { playerId: string; card: Card }[];
  leadSuit?: 'SPADE' | 'DIAMOND' | 'HEART' | 'CLUB';
  winnerPlayerId?: string;
}

export interface GameState {
  roomId: string;
  phase: 'LOBBY' | 'BIDDING' | 'PLAYING' | 'ENDED';
  turnPlayerId: string;
  currentTrick: Trick | null;
  tricks: Trick[];
  kitty: Card[];
  giruda: 'SPADE' | 'DIAMOND' | 'HEART' | 'CLUB' | 'NO_GIRUDA';
  ownerPlayerId: string;
  friendPlayerId?: string;
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
