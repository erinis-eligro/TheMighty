/**
 * Socket.io protocol spec for the `/game` namespace.
 *
 * This file contains only types/constants (no runtime imports) so it can be
 * copied verbatim to the frontend: `frontend/src/types/protocol.ts`.
 * Keep both files in sync when changing the protocol.
 *
 * Every client -> server request is acknowledged with an `Ack<T>` envelope:
 *   success: { ok: true,  data: T }
 *   failure: { ok: false, error: { code, message } }
 * On failure the server additionally emits a `game_error` event to the
 * requesting client.
 */

export const GAME_NAMESPACE = '/game';

/** Event names of the `/game` namespace (both directions). Never use the string literals directly. */
export const GAME_EVENTS = {
  // Lobby / room
  CREATE_ROOM: 'create_room',
  JOIN_ROOM: 'join_room',
  LEAVE_ROOM: 'leave_room',
  ROOM_CREATED: 'room_created',
  ROOM_JOINED: 'room_joined',
  PLAYER_LEFT: 'player_left',

  // Game flow
  START_GAME: 'start_game',
  GAME_STARTED: 'game_started',
  DEAL_COMPLETE: 'deal_complete',

  // Bidding
  PLACE_BID: 'place_bid',
  BID_PLACED: 'bid_placed',
  BID_ROUND_COMPLETE: 'bid_round_complete',

  // Friend selection
  DECLARE_FRIEND: 'declare_friend',
  FRIEND_DECLARED: 'friend_declared',
  FRIEND_REVEALED: 'friend_revealed',

  // Kitty exchange
  EXCHANGE_KITTY: 'exchange_kitty',
  KITTY_EXCHANGED: 'kitty_exchanged',

  // Turn play
  PLAY_CARD: 'play_card',
  CARD_PLAYED: 'card_played',
  TURN_COMPLETE: 'turn_complete',
  TRICK_RESOLVED: 'trick_resolved',

  // Game end
  GAME_END: 'game_end',

  // Errors / state
  GAME_ERROR: 'game_error',
  GET_STATE: 'get_state',
  STATE_SYNC: 'state_sync',
} as const;

export type GameEvent = (typeof GAME_EVENTS)[keyof typeof GAME_EVENTS];

export interface AckError {
  code: string;
  message: string;
}

export type Ack<T = unknown> =
  | { ok: true; data: T; error?: undefined }
  | { ok: false; data?: undefined; error: AckError };

/**
 * `code` of a `game_error` the server sends when it can no longer drive the game (an AI step and its
 * fallback, or the trick advance, failed). The session is gone: the client should offer a new game.
 */
export const SESSION_FAILED_CODE = 'SESSION_FAILED';

/** Payload of the `game_error` event. */
export type GameErrorPayload = AckError;

// ---- Client -> Server requests and their ack data ----

export interface CreateRoomRequest {
  username: string;
}
export interface RoomAckData {
  roomId: string;
  playerId: string;
}
/**
 * Ack of create_room. `rejoinToken` is a secret for this session only: keep it (e.g. in
 * sessionStorage) and present it to `join_room` to take the seat back after a reload/reconnect.
 */
export interface CreateRoomAckData extends RoomAckData {
  rejoinToken: string;
}

/** Single-player rejoin: binds the new socket to the session's human seat. */
export interface JoinRoomRequest {
  roomId: string;
  rejoinToken: string;
}

export interface LeaveRoomRequest {
  roomId: string;
  /** Optional: the server identifies the player by the socket; if sent it must match. */
  playerId?: string;
}

export interface GetStateRequest {
  roomId: string;
}
export interface RoomIdAckData {
  roomId: string;
}

export interface StartGameRequest {
  roomId: string;
}
/** start_game is idempotent: `alreadyStarted` is true when the game was already dealt. */
export interface StartGameAckData extends RoomIdAckData {
  alreadyStarted: boolean;
}

export interface PlaceBidRequest {
  roomId: string;
  /** Optional: the server identifies the player by the socket; if sent it must match. */
  playerId?: string;
  bid?: number;
  /** SPADE | DIAMOND | HEART | CLUB | NO_GIRUDA. Required unless passing. */
  giruda?: string;
  pass?: boolean;
}

export interface ExchangeKittyRequest {
  roomId: string;
  /** Optional: the server identifies the player by the socket; if sent it must match. */
  playerId?: string;
  /** Exactly 3 distinct card ids from the president's 13 cards (hand + kitty). */
  discardCardIds: string[];
  /** Final giruda; omit to keep the bid giruda. */
  giruda?: string;
  /** Raised bid score; required only when the giruda is changed. */
  bidScore?: number;
}

export interface DeclareFriendRequest {
  roomId: string;
  /** Optional: the server identifies the player by the socket; if sent it must match. */
  playerId?: string;
  /** NO_FRIEND | FIRST_TRICK | MIGHTY | JOKER | CARD */
  type: string;
  /** Required when type is CARD. */
  suit?: string;
  /** Required when type is CARD. */
  rank?: string;
}

export interface PlayCardRequest {
  roomId: string;
  /** Optional: the server identifies the player by the socket; if sent it must match. */
  playerId?: string;
  cardId: string;
  /** Leader declares the joker call (leading with the joker-call card). */
  jokerCall?: boolean;
  /** Suit named when leading with the joker. */
  jokerLeadSuit?: 'SPADE' | 'DIAMOND' | 'HEART' | 'CLUB';
}

type AckFn<T> = (res: Ack<T>) => void;

export interface ClientToServerEvents {
  [GAME_EVENTS.CREATE_ROOM]: (payload: CreateRoomRequest, ack?: AckFn<CreateRoomAckData>) => void;
  [GAME_EVENTS.JOIN_ROOM]: (payload: JoinRoomRequest, ack?: AckFn<RoomAckData>) => void;
  [GAME_EVENTS.LEAVE_ROOM]: (payload: LeaveRoomRequest, ack?: AckFn<RoomAckData>) => void;
  [GAME_EVENTS.GET_STATE]: (payload: GetStateRequest, ack?: AckFn<RoomIdAckData>) => void;
  [GAME_EVENTS.START_GAME]: (payload: StartGameRequest, ack?: AckFn<StartGameAckData>) => void;
  [GAME_EVENTS.PLACE_BID]: (payload: PlaceBidRequest, ack?: AckFn<RoomAckData>) => void;
  [GAME_EVENTS.EXCHANGE_KITTY]: (payload: ExchangeKittyRequest, ack?: AckFn<RoomAckData>) => void;
  [GAME_EVENTS.DECLARE_FRIEND]: (payload: DeclareFriendRequest, ack?: AckFn<RoomAckData>) => void;
  [GAME_EVENTS.PLAY_CARD]: (payload: PlayCardRequest, ack?: AckFn<RoomAckData>) => void;
}

// ---- Server -> Client events ----
// Every event the server emits. Per-player payloads (`state_sync`, `game_started`, ...) are already
// masked for the receiving player: other hands, the kitty (except for the president) and the
// friend (until revealed) are never part of them.

export interface WireCard {
  id: string;
  suit: 'SPADE' | 'DIAMOND' | 'HEART' | 'CLUB' | 'JOKER';
  rank: '2' | '3' | '4' | '5' | '6' | '7' | '8' | '9' | '10' | 'J' | 'Q' | 'K' | 'A';
  isJoker: boolean;
}

export interface WireTrick {
  id: string;
  trickNumber: number;
  cards: { playerId: string; playerIndex: number; card: WireCard }[];
  leadSuit?: 'SPADE' | 'DIAMOND' | 'HEART' | 'CLUB';
  winnerPlayerId?: string;
  winnerIndex?: number;
}

export interface RoundResultPayload {
  isWin: boolean;
  bidScore: number;
  giruda: string;
  teamPoints: number;
  opponentPoints: number;
  ownerPlayerId: string;
  friendPlayerId: string | null;
  players: { playerId: string; role: 'OWNER' | 'FRIEND' | 'OPPOSER'; points: number }[];
}

/** The minimum a masked game state has to contain; the concrete shape is owned by the sender/receiver. */
export interface SyncStateBase {
  players: unknown[];
}

export interface RoomCreatedPayload<S extends SyncStateBase = SyncStateBase> {
  roomId: string;
  playerId: string;
  players: S['players'];
  giruda: string;
}
export interface RoomJoinedPayload<S extends SyncStateBase = SyncStateBase> {
  roomId: string;
  playerId: string;
  players: S['players'];
}
export interface PlayerLeftPayload {
  roomId: string;
  playerId: string;
}
export interface DealCompletePayload {
  roomId: string;
  players: { id: string; handCount: number }[];
}
export interface GameStartedPayload<S extends SyncStateBase = SyncStateBase> {
  roomId: string;
  players: S['players'];
}
export interface BidPlacedPayload {
  roomId: string;
  playerId: string;
  bid: number | null;
  giruda: string | null;
  pass: boolean;
}
export interface BidRoundCompletePayload {
  roomId: string;
  redealt: boolean;
  presidentPlayerId?: string | null;
}
export interface FriendDeclaredPayload {
  roomId: string;
  playerId: string;
  declaration: { type: string; suit?: string; rank?: string };
}
export interface FriendRevealedPayload {
  roomId: string;
  friendPlayerId: string | null;
  friendIndex: number | null;
  reason: string;
}
export interface KittyExchangedPayload {
  roomId: string;
  playerId: string;
  giruda: string;
  bidScore: number;
}
export interface CardPlayedPayload {
  roomId: string;
  playerId: string;
  cardId: string;
}
export interface TurnCompletePayload {
  roomId: string;
  trick: WireTrick;
  winnerPlayerId?: string;
  points?: number;
}
export interface TrickResolvedPayload {
  roomId: string;
  trick: WireTrick;
  trickNumber: number;
  winnerPlayerId?: string;
  winnerIndex?: number;
  points?: number;
  collectedScoreCards: WireCard[];
  friendPlayerId?: string | null;
}
export interface GameEndPayload extends RoundResultPayload {
  roomId: string;
  humanRole: 'OWNER' | 'FRIEND' | 'OPPOSER' | null;
  humanWon: boolean;
}

/** `S` is the masked game state carried by `state_sync` (defined by the backend / the frontend store). */
export interface ServerToClientEvents<S extends SyncStateBase = SyncStateBase> {
  [GAME_EVENTS.ROOM_CREATED]: (payload: RoomCreatedPayload<S>) => void;
  [GAME_EVENTS.ROOM_JOINED]: (payload: RoomJoinedPayload<S>) => void;
  [GAME_EVENTS.PLAYER_LEFT]: (payload: PlayerLeftPayload) => void;
  [GAME_EVENTS.DEAL_COMPLETE]: (payload: DealCompletePayload) => void;
  [GAME_EVENTS.GAME_STARTED]: (payload: GameStartedPayload<S>) => void;
  [GAME_EVENTS.STATE_SYNC]: (payload: S) => void;
  [GAME_EVENTS.BID_PLACED]: (payload: BidPlacedPayload) => void;
  [GAME_EVENTS.BID_ROUND_COMPLETE]: (payload: BidRoundCompletePayload) => void;
  [GAME_EVENTS.FRIEND_DECLARED]: (payload: FriendDeclaredPayload) => void;
  [GAME_EVENTS.FRIEND_REVEALED]: (payload: FriendRevealedPayload) => void;
  [GAME_EVENTS.KITTY_EXCHANGED]: (payload: KittyExchangedPayload) => void;
  [GAME_EVENTS.CARD_PLAYED]: (payload: CardPlayedPayload) => void;
  [GAME_EVENTS.TURN_COMPLETE]: (payload: TurnCompletePayload) => void;
  [GAME_EVENTS.TRICK_RESOLVED]: (payload: TrickResolvedPayload) => void;
  [GAME_EVENTS.GAME_END]: (payload: GameEndPayload) => void;
  [GAME_EVENTS.GAME_ERROR]: (payload: GameErrorPayload) => void;
}
