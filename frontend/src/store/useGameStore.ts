import { create } from 'zustand';
import type { Socket } from 'socket.io-client';
import { createGameSocket, emitWithAck } from '@/lib/socket';
import { clearSession, loadSession, saveSession } from '@/lib/session';
import type { CreateRoomAckData, GameErrorPayload, RoomAckData } from '@/types/protocol';

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

export type BidGiruda = Suit | 'NO_GIRUDA';

export type Bid = {
  bidderIndex: number;
  score: number;
  giruda: BidGiruda;
};

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
  hasPassed?: boolean;
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

/** Fields the server sends with every `state_sync` (already masked for this player). */
type SyncedState = Pick<
  GameState,
  | 'roomId' | 'phase' | 'currentTurnIndex' | 'turnPlayerId' | 'players' | 'currentTrick' | 'trickHistory'
  | 'currentTrickNumber' | 'leadSuit' | 'isJokerCallActive' | 'kitty' | 'giruda' | 'ownerPlayerId'
  | 'presidentIndex' | 'friendDeclaration' | 'friendIndex' | 'friendPlayerId' | 'friendRevealed'
  | 'passCount' | 'currentBid' | 'highestBid' | 'bidLeader' | 'playableCardIds'
>;

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
  /** True once the friend is public (or the president plays without one). */
  friendRevealed: boolean;
  passCount: number;
  currentBid: number;
  highestBid: Bid | null;
  bidLeader?: string;
  /** Card ids the server says the viewer may play now (empty unless it is his turn). */
  playableCardIds: string[];
  isConnected: boolean;
  /** Last socket connection failure (cleared on connect); shown by the connection banner. */
  connectionError: string | null;
  error: string | null;

  setSocket: (socket: Socket) => void;
  /** The one place that creates the game socket and registers the server event listeners. */
  connect: (url?: string) => void;
  /** Reconnect manually after the automatic retries gave up or the user asks for it. */
  retryConnection: () => void;
  disconnect: () => void;
  /** create_room: resolves true once the room exists and credentials are stored for a rejoin. */
  createRoom: (username: string) => Promise<boolean>;
  /** join_room with the stored rejoin token; clears the stored session when the server refuses. */
  rejoinRoom: (roomId?: string) => Promise<boolean>;
  /** Leaves (deletes) the single-player room and forgets the stored session. */
  leaveRoom: () => void;
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

export const useGameStore = create<GameState>((set, get) => ({
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
  friendRevealed: false,
  passCount: 0,
  currentBid: 0,
  highestBid: null,
  playableCardIds: [],
  isConnected: false,
  connectionError: null,
  error: null,

  setSocket: (socket) => set({ socket }),
  connect: (url) => {
    if (get().socket) return;
    const socket = createGameSocket(url);
    socket.on('connect', () => {
      set({ isConnected: true, connectionError: null });
      // The server unbinds the seat on disconnect: take it back after an automatic reconnect.
      if (get().playerId) void get().rejoinRoom(get().roomId);
    });
    socket.on('disconnect', () => set({ isConnected: false }));
    socket.on('connect_error', (err) => set({ isConnected: false, connectionError: err.message }));
    socket.on('game_error', (e: GameErrorPayload) => set({ error: e.message }));
    socket.on('room_created', (data: { roomId: string; playerId: string }) =>
      set({ roomId: data.roomId, playerId: data.playerId, phase: 'READY' }),
    );
    // The server state is the single source of truth: it replaces the whole game view.
    socket.on('state_sync', (data: SyncedState) =>
      set({ ...data, friendRevealed: data.friendRevealed ?? false, playableCardIds: data.playableCardIds ?? [] }),
    );
    socket.on('player_left', (data: { playerId: string }) =>
      set((s) => ({ players: s.players.filter((p) => p.id !== data.playerId) })),
    );
    set({ socket });
  },
  retryConnection: () => {
    const { socket } = get();
    if (socket && !socket.connected) {
      set({ connectionError: null });
      socket.connect();
    }
  },
  disconnect: () => {
    get().socket?.disconnect();
    set({ socket: null, isConnected: false });
  },
  createRoom: async (username) => {
    const { socket } = get();
    if (!socket) return false;
    get().reset();
    const res = await emitWithAck<CreateRoomAckData>(socket, 'create_room', { username });
    if (!res.ok) {
      set({ error: res.error.message });
      return false;
    }
    saveSession({ ...res.data, username });
    set({ error: null, roomId: res.data.roomId, playerId: res.data.playerId, username });
    return true;
  },
  rejoinRoom: async (roomId) => {
    const { socket } = get();
    const saved = loadSession();
    if (!socket || !saved || (roomId && saved.roomId !== roomId)) return false;
    const res = await emitWithAck<RoomAckData>(socket, 'join_room', {
      roomId: saved.roomId,
      rejoinToken: saved.rejoinToken,
    });
    if (!res.ok) {
      clearSession();
      set({ error: res.error.message, roomId: '', playerId: '' });
      return false;
    }
    set({ error: null, roomId: res.data.roomId, playerId: res.data.playerId, username: saved.username });
    return true;
  },
  leaveRoom: () => {
    const { socket, roomId, playerId } = get();
    if (socket && roomId) socket.emit('leave_room', { roomId, playerId });
    clearSession();
    get().reset();
    set({ roomId: '', playerId: '' });
  },
  setRoom: (roomId, playerId, username) => set({ roomId, playerId, username }),
  setPlayers: (players) => set({ players }),
  setPhase: (phase) => set({ phase }),
  setTurn: (turnPlayerId) => set({ turnPlayerId }),
  setCurrentTrick: (currentTrick) => set({ currentTrick }),
  addTrick: (trick) => set((s) => ({ trickHistory: [...s.trickHistory, trick] })),
  setKitty: (kitty) => set({ kitty }),
  setGiruda: (giruda) => set({ giruda }),
  setBid: (currentBid, bidLeader) => set({ currentBid, bidLeader }),
  setError: (error) => set({ error }),
  reset: () => set({
    phase: 'READY', players: [], currentTrick: null, trickHistory: [], currentTrickNumber: 0,
    currentTurnIndex: 0, turnPlayerId: '', leadSuit: null, isJokerCallActive: false, kitty: [],
    presidentIndex: null, friendDeclaration: null, friendIndex: null, friendPlayerId: undefined, friendRevealed: false,
    passCount: 0, currentBid: 0, highestBid: null, bidLeader: undefined, playableCardIds: [], error: null,
  }),
}));
