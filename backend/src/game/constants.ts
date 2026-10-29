export const GAME_EVENTS = {
  // Lobby / room
  CREATE_ROOM: 'create_room',
  JOIN_ROOM: 'join_room',
  LEAVE_ROOM: 'leave_room',
  ROOM_CREATED: 'room_created',
  ROOM_JOINED: 'room_joined',
  PLAYER_JOINED: 'player_joined',
  PLAYER_LEFT: 'player_left',
  ROOM_ERROR: 'room_error',

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
  TURN_BEGIN: 'turn_begin',
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

export const SEAT_POSITIONS = ['bottom', 'top', 'left', 'right', 'center'] as const;
export type SeatPosition = (typeof SEAT_POSITIONS)[number];

export const DEFAULT_BID_MIN = 13;

/** How long a completed trick stays on the board (TRICK_RESOLVED) before the next trick starts. */
export const TRICK_RESOLVED_DELAY_MS = 1500;

/** AI players act after a random delay in [AI_TURN_DELAY_MIN_MS, AI_TURN_DELAY_MAX_MS]. */
export const AI_TURN_DELAY_MIN_MS = 1000;
export const AI_TURN_DELAY_MAX_MS = 1500;

export function getAiTurnDelayMs(random: () => number = Math.random): number {
  return Math.round(AI_TURN_DELAY_MIN_MS + random() * (AI_TURN_DELAY_MAX_MS - AI_TURN_DELAY_MIN_MS));
}

/** How long a session survives after its human disconnected; afterwards it is deleted. */
export const SESSION_TTL_MS = 5 * 60 * 1000;
