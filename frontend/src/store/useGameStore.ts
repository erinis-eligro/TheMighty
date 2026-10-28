import { create } from 'zustand';
import type { Socket } from 'socket.io-client';
import { createGameSocket } from '@/lib/socket';
import type { GameErrorPayload } from '@/types/protocol';

export type Card = {
  id: string;
  suit: 'SPADE' | 'DIAMOND' | 'HEART' | 'CLUB' | 'JOKER';
  rank: '3' | '4' | '5' | '6' | '7' | '8' | '9' | '10' | 'J' | 'Q' | 'K' | 'A' | '2';
  isJoker: boolean;
  hidden?: boolean;
};

export type Player = {
  id: string;
  username: string;
  seat: 'bottom' | 'top' | 'left' | 'right' | 'center';
  isAi: boolean;
  hand: Card[];
  handCount: number;
  trickScore: number;
  isFriend: boolean;
  isOwner: boolean;
  bid?: number;
};

export type Trick = {
  id: string;
  cards: { playerId: string; card: Card }[];
  leadSuit?: string;
  winnerPlayerId?: string;
};

type GamePhase = 'LOBBY' | 'BIDDING' | 'PLAYING' | 'ENDED';

interface GameState {
  socket: Socket | null;
  roomId: string;
  playerId: string;
  username: string;
  phase: GamePhase;
  turnPlayerId: string;
  players: Player[];
  currentTrick: Trick | null;
  tricks: Trick[];
  kitty: Card[];
  giruda: string;
  ownerPlayerId: string;
  friendPlayerId?: string;
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
  phase: 'LOBBY',
  turnPlayerId: '',
  players: [],
  currentTrick: null,
  tricks: [],
  kitty: [],
  giruda: 'NO_GIRUDA',
  ownerPlayerId: '',
  currentBid: 0,
  isConnected: false,
  error: null,

  setSocket: (socket) => set({ socket }),
  connect: (url) => {
    const socket = createGameSocket(url);
    socket.on('connect', () => set({ isConnected: true }));
    socket.on('disconnect', () => set({ isConnected: false }));
    socket.on('connect_error', (err) => set({ error: err.message }));
    socket.on('game_error', (e: GameErrorPayload) => set({ error: e.message }));
    socket.on('room_created', (data: { roomId: string; playerId: string }) =>
      set({ roomId: data.roomId, playerId: data.playerId, phase: 'LOBBY' }),
    );
    socket.on('state_sync', (data: any) =>
      set({
        roomId: data.roomId,
        phase: data.phase,
        turnPlayerId: data.turnPlayerId,
        currentTrick: data.currentTrick,
        tricks: data.tricks,
        kitty: data.kitty,
        giruda: data.giruda,
        ownerPlayerId: data.ownerPlayerId,
        friendPlayerId: data.friendPlayerId,
        currentBid: data.currentBid,
        bidLeader: data.bidLeader,
        players: data.players,
      }),
    );
    set({ socket });
  },
  disconnect: () => set((s) => { s.socket?.disconnect(); return { socket: null, isConnected: false }; }),
  setRoom: (roomId, playerId, username) => set({ roomId, playerId, username }),
  setPlayers: (players) => set({ players }),
  setPhase: (phase) => set({ phase }),
  setTurn: (turnPlayerId) => set({ turnPlayerId }),
  setCurrentTrick: (currentTrick) => set({ currentTrick }),
  addTrick: (trick) => set((s) => ({ tricks: [...s.tricks, trick], currentTrick: null })),
  setKitty: (kitty) => set({ kitty }),
  setGiruda: (giruda) => set({ giruda }),
  setBid: (currentBid, bidLeader) => set({ currentBid, bidLeader }),
  setError: (error) => set({ error }),
  reset: () => set({
    phase: 'LOBBY', players: [], currentTrick: null, tricks: [], kitty: [], currentBid: 0,
    bidLeader: undefined, error: null,
  }),
}));
