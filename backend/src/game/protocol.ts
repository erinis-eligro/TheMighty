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

export interface AckError {
  code: string;
  message: string;
}

export type Ack<T = unknown> =
  | { ok: true; data: T; error?: undefined }
  | { ok: false; data?: undefined; error: AckError };

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

export interface JoinRoomRequest {
  roomId: string;
  username: string;
}

export interface LeaveRoomRequest {
  roomId: string;
  playerId: string;
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

export interface PlaceBidRequest {
  roomId: string;
  playerId: string;
  bid?: number;
  pass?: boolean;
}

export interface ExchangeKittyRequest {
  roomId: string;
  playerId: string;
  /** Exactly 3 distinct card ids from the president's 13 cards (hand + kitty). */
  discardCardIds: string[];
  /** Final giruda; omit to keep the bid giruda. */
  giruda?: string;
  /** Raised bid score; required only when the giruda is changed. */
  bidScore?: number;
}

export interface DeclareFriendRequest {
  roomId: string;
  playerId: string;
  /** NO_FRIEND | FIRST_TRICK | MIGHTY | JOKER | CARD */
  type: string;
  /** Required when type is CARD. */
  suit?: string;
  /** Required when type is CARD. */
  rank?: string;
}

export interface PlayCardRequest {
  roomId: string;
  playerId: string;
  cardId: string;
  /** Leader declares the joker call (leading with the joker-call card). */
  jokerCall?: boolean;
  /** Suit named when leading with the joker. */
  jokerLeadSuit?: 'SPADE' | 'DIAMOND' | 'HEART' | 'CLUB';
}

type AckFn<T> = (res: Ack<T>) => void;

export interface ClientToServerEvents {
  create_room: (payload: CreateRoomRequest, ack?: AckFn<RoomAckData>) => void;
  join_room: (payload: JoinRoomRequest, ack?: AckFn<RoomAckData>) => void;
  leave_room: (payload: LeaveRoomRequest, ack?: AckFn<RoomAckData>) => void;
  get_state: (payload: GetStateRequest, ack?: AckFn<RoomIdAckData>) => void;
  start_game: (payload: StartGameRequest, ack?: AckFn<RoomIdAckData>) => void;
  place_bid: (payload: PlaceBidRequest, ack?: AckFn<RoomAckData>) => void;
  exchange_kitty: (payload: ExchangeKittyRequest, ack?: AckFn<RoomAckData>) => void;
  declare_friend: (payload: DeclareFriendRequest, ack?: AckFn<RoomAckData>) => void;
  play_card: (payload: PlayCardRequest, ack?: AckFn<RoomAckData>) => void;
}

// ---- Server -> Client events ----
// Broadcast events (room_created, state_sync, bid_placed, ...) keep their
// existing payloads; see GameGateway.

export interface ServerToClientEvents {
  game_error: (payload: GameErrorPayload) => void;
}
