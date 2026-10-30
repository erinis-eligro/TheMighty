import { create } from 'zustand';
import { createGameSocket, emitWithAck, type GameSocket } from '@/lib/socket';
import { clearSession, loadSession, saveSession } from '@/lib/session';
import type {
  ClientToServerEvents,
  DeclareFriendRequest,
  ExchangeKittyRequest,
  PlaceBidRequest,
  PlayCardRequest,
} from '@/types/protocol';
import { GAME_EVENTS, SESSION_FAILED_CODE } from '@/types/protocol';

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

export type PlayerRole = 'OWNER' | 'FRIEND' | 'OPPOSER';

/** Scored outcome the server attaches to `state_sync` once the phase is GAME_OVER. */
export type RoundResult = {
  isWin: boolean;
  bidScore: number;
  giruda: BidGiruda;
  teamPoints: number;
  opponentPoints: number;
  ownerPlayerId: string;
  friendPlayerId: string | null;
  players: { playerId: string; role: PlayerRole; points: number }[];
};

/** Fields the server sends with every `state_sync` (already masked for this player). */
type SyncedState = Pick<
  GameState,
  | 'roomId' | 'phase' | 'currentTurnIndex' | 'turnPlayerId' | 'players' | 'currentTrick' | 'trickHistory'
  | 'currentTrickNumber' | 'leadSuit' | 'isJokerCallActive' | 'jokerCallCard' | 'kitty' | 'giruda' | 'ownerPlayerId'
  | 'presidentIndex' | 'friendDeclaration' | 'friendIndex' | 'friendPlayerId' | 'friendRevealed'
  | 'passCount' | 'currentBid' | 'highestBid' | 'bidLeader' | 'playableCardIds' | 'result'
>;

interface GameState {
  socket: GameSocket<SyncedState> | null;
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
  /** The card that calls the joker for the current giruda (public rule info). */
  jokerCallCard: { suit: Card['suit']; rank: Card['rank'] } | null;
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
  /** Final scoring, only present in GAME_OVER. */
  result: RoundResult | null;
  isConnected: boolean;
  /** Last socket connection failure (cleared on connect); shown by the connection banner. */
  connectionError: string | null;
  error: string | null;
  /** The server gave up on this game (fatal `game_error`): the only way out is a new game or the lobby. */
  sessionFailed: boolean;

  setSocket: (socket: GameSocket<SyncedState>) => void;
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
  /** Bidding/kitty/friend requests: the server validates and answers with a state_sync; resolves true on success. */
  placeBid: (action: Pick<PlaceBidRequest, 'bid' | 'giruda' | 'pass'>) => Promise<boolean>;
  exchangeKitty: (action: Pick<ExchangeKittyRequest, 'discardCardIds' | 'giruda' | 'bidScore'>) => Promise<boolean>;
  declareFriend: (action: Pick<DeclareFriendRequest, 'type' | 'suit' | 'rank'>) => Promise<boolean>;
  /** Asks the server to play a card; the server validates it and answers with a state_sync. */
  playCard: (action: Pick<PlayCardRequest, 'cardId' | 'jokerCall' | 'jokerLeadSuit'>) => Promise<boolean>;
  setRoom: (roomId: string, playerId: string, username: string) => void;
  setError: (error: string | null) => void;
  reset: () => void;
}

/** Sends a user action for the current room; surfaces a refusal through `error`. */
async function sendAction(
  get: () => GameState,
  set: (partial: Partial<GameState>) => void,
  event: typeof GAME_EVENTS.PLACE_BID | typeof GAME_EVENTS.EXCHANGE_KITTY | typeof GAME_EVENTS.DECLARE_FRIEND | typeof GAME_EVENTS.PLAY_CARD,
  action: Omit<Parameters<ClientToServerEvents[typeof event]>[0], 'roomId' | 'playerId'>,
): Promise<boolean> {
  const { socket, roomId } = get();
  if (!socket || !roomId) return false;
  const res = await emitWithAck(socket, event, { roomId, ...action } as Parameters<ClientToServerEvents[typeof event]>[0]);
  set({ error: res.ok ? null : res.error.message });
  return res.ok;
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
  jokerCallCard: null,
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
  result: null,
  isConnected: false,
  connectionError: null,
  error: null,
  sessionFailed: false,

  setSocket: (socket) => set({ socket }),
  connect: (url) => {
    if (get().socket) return;
    const socket = createGameSocket<SyncedState>(url);
    socket.on('connect', () => {
      set({ isConnected: true, connectionError: null });
      // The server unbinds the seat on disconnect: take it back after an automatic reconnect.
      if (get().playerId) void get().rejoinRoom(get().roomId);
    });
    socket.on('disconnect', () => set({ isConnected: false }));
    socket.on('connect_error', (err) => set({ isConnected: false, connectionError: err.message }));
    socket.on(GAME_EVENTS.GAME_ERROR, (e) =>
      set(e.code === SESSION_FAILED_CODE ? { sessionFailed: true, error: null } : { error: e.message }),
    );
    socket.on(GAME_EVENTS.ROOM_CREATED, (data) =>
      set({ roomId: data.roomId, playerId: data.playerId, phase: 'READY' }),
    );
    // The server state is the single source of truth: it replaces the whole game view.
    socket.on(GAME_EVENTS.STATE_SYNC, (data) =>
      set({
        ...data,
        friendRevealed: data.friendRevealed ?? false,
        playableCardIds: data.playableCardIds ?? [],
        jokerCallCard: data.jokerCallCard ?? null,
        result: data.result ?? null,
      }),
    );
    socket.on(GAME_EVENTS.PLAYER_LEFT, (data) =>
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
    const res = await emitWithAck(socket, GAME_EVENTS.CREATE_ROOM, { username });
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
    const res = await emitWithAck(socket, GAME_EVENTS.JOIN_ROOM, {
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
    if (socket && roomId) socket.emit(GAME_EVENTS.LEAVE_ROOM, playerId ? { roomId, playerId } : { roomId });
    clearSession();
    get().reset();
    set({ roomId: '', playerId: '' });
  },
  placeBid: (action) => sendAction(get, set, GAME_EVENTS.PLACE_BID, action),
  exchangeKitty: (action) => sendAction(get, set, GAME_EVENTS.EXCHANGE_KITTY, action),
  declareFriend: (action) => sendAction(get, set, GAME_EVENTS.DECLARE_FRIEND, action),
  playCard: (action) => sendAction(get, set, GAME_EVENTS.PLAY_CARD, action),
  setRoom: (roomId, playerId, username) => set({ roomId, playerId, username }),
  setError: (error) => set({ error }),
  reset: () => set({
    phase: 'READY', players: [], currentTrick: null, trickHistory: [], currentTrickNumber: 0,
    currentTurnIndex: 0, turnPlayerId: '', leadSuit: null, isJokerCallActive: false, jokerCallCard: null, kitty: [],
    presidentIndex: null, friendDeclaration: null, friendIndex: null, friendPlayerId: undefined, friendRevealed: false,
    passCount: 0, currentBid: 0, highestBid: null, bidLeader: undefined, playableCardIds: [], result: null, error: null, sessionFailed: false,
  }),
}));
