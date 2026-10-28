import { create } from 'zustand';
import { io, Socket } from 'socket.io-client';

const BACKEND_URL = process.env.NEXT_PUBLIC_BACKEND_URL ?? 'http://localhost:3001';

export type Card = {
  id: string;
  suit: 'SPADE' | 'DIAMOND' | 'HEART' | 'CLUB' | 'JOKER';
  rank: '2' | '3' | '4' | '5' | '6' | '7' | '8' | '9' | '10' | 'J' | 'Q' | 'K' | 'A';
  isJoker: boolean;
  hidden?: boolean;
};

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

export type FriendDeclaration =
  | { type: 'NO_FRIEND' }
  | { type: 'FIRST_TRICK' }
  | { type: 'MIGHTY' }
  | { type: 'JOKER' }
  | { type: 'CARD'; suit: Suit; rank: Card['rank'] };

export type Player = {
  id: string;
  username: string;
  seat: 'bottom' | 'top' | 'left' | 'right' | 'center';
  isAi: boolean;
  hand: Card[];
  handCount: number;
  collectedScoreCards: Card[];
  score: number;
  isFriend: boolean;
  isOwner: boolean;
  bid?: number;
};

export type TrickCard = {
  playerId: string;
  playerIndex: number;
  card: Card;
};

export type Trick = {
  id: string;
  trickNumber: number;
  cards: TrickCard[];
  leadSuit?: Suit;
  winnerPlayerId?: string;
  winnerIndex?: number;
};

interface GameState {
  socket: Socket | null;
  roomId: string;
  playerId: string;
  username: string;
  phase: GamePhase;
  /** Source of truth for the current turn (index into `players`). */
  currentTurnIndex: number;
  /** Mirror of `players[currentTurnIndex].id`. */
  turnPlayerId: string;
  players: Player[];
  currentTrick: Trick | null;
  trickHistory: Trick[];
  currentTrickNumber: number;
  leadSuit: Suit | null;
  isJokerCallActive: boolean;
  kitty: Card[];
  giruda: string;
  ownerPlayerId: string;
  presidentIndex: number | null;
  friendDeclaration: FriendDeclaration | null;
  friendIndex: number | null;
  friendPlayerId?: string;
  passCount: number;
  currentBid: number;
  bidLeader?: string;
  isConnected: boolean;
  error: string | null;

  setSocket: (socket: Socket) => void;
  connect: (url?: string) => void;
  disconnect: () => void;
  setRoom: (roomId: string, playerId: string, username: string) => void;
  setPlayers: (players: Player[]) => void;
  setPhase: (phase: GamePhase) => void;
  setTurn: (playerId: string) => void;
  setCurrentTrick: (trick: Trick | null) => void;
  addTrick: (trick: Trick) => void;
  setKitty: (cards: Card[]) => void;
  setGiruda: (giruda: string) => void;
  setBid: (bid: number, leader?: string) => void;
  setError: (error: string | null) => void;
  reset: () => void;
}

export const useGameStore = create<GameState>((set) => ({
  socket: null,
  roomId: '',
  playerId: '',
  username: '',
  phase: 'READY',
  currentTurnIndex: 0,
  turnPlayerId: '',
  players: [],
  currentTrick: null,
  trickHistory: [],
  currentTrickNumber: 0,
  leadSuit: null,
  isJokerCallActive: false,
  kitty: [],
  giruda: 'NO_GIRUDA',
  ownerPlayerId: '',
  presidentIndex: null,
  friendDeclaration: null,
  friendIndex: null,
  passCount: 0,
  currentBid: 0,
  isConnected: false,
  error: null,

  setSocket: (socket) => set({ socket }),
  connect: (url = BACKEND_URL) => {
    const socket = io(url, { transports: ['websocket', 'polling'] });
    socket.on('connect', () => set({ isConnected: true }));
    socket.on('disconnect', () => set({ isConnected: false }));
    socket.on('connect_error', (err) => set({ error: err.message }));
    set({ socket });
  },
  disconnect: () => set((s) => { s.socket?.disconnect(); return { socket: null, isConnected: false }; }),
  setRoom: (roomId, playerId, username) => set({ roomId, playerId, username }),
  setPlayers: (players) => set({ players }),
  setPhase: (phase) => set({ phase }),
  setTurn: (turnPlayerId) => set({ turnPlayerId }),
  setCurrentTrick: (currentTrick) => set({ currentTrick }),
  addTrick: (trick) => set((s) => ({ trickHistory: [...s.trickHistory, trick], currentTrick: null })),
  setKitty: (kitty) => set({ kitty }),
  setGiruda: (giruda) => set({ giruda }),
  setBid: (currentBid, bidLeader) => set({ currentBid, bidLeader }),
  setError: (error) => set({ error }),
  reset: () => set({
    phase: 'READY', players: [], currentTrick: null, trickHistory: [], currentTrickNumber: 0,
    currentTurnIndex: 0, turnPlayerId: '', leadSuit: null, isJokerCallActive: false, kitty: [],
    presidentIndex: null, friendDeclaration: null, friendIndex: null, friendPlayerId: undefined,
    passCount: 0, currentBid: 0, bidLeader: undefined, error: null,
  }),
}));
