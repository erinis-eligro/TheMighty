// Event names live in the shared protocol (copied verbatim to the frontend).
export { GAME_EVENTS } from './protocol';
export type { GameEvent } from './protocol';

export const SEAT_POSITIONS = ['bottom', 'top', 'left', 'right', 'center'] as const;
export type SeatPosition = (typeof SEAT_POSITIONS)[number];

export const DEFAULT_BID_MIN = 13;

/**
 * Pacing delays. The constants are the defaults; each can be overridden with an environment
 * variable of the same name (a non-negative integer in ms), e.g. to run automated tests quickly.
 */

/** How long a completed trick stays on the board (TRICK_RESOLVED) before the next trick starts. */
export const TRICK_RESOLVED_DELAY_MS = 1500;

/** AI players act after a random delay in [AI_TURN_DELAY_MIN_MS, AI_TURN_DELAY_MAX_MS]. */
export const AI_TURN_DELAY_MIN_MS = 1000;
export const AI_TURN_DELAY_MAX_MS = 1500;

/** Reads a non-negative integer (ms) from the environment; anything else falls back to `fallback`. */
function envDelayMs(name: string, fallback: number): number {
  const raw = process.env[name]?.trim();
  if (!raw || !/^\d+$/.test(raw)) return fallback;
  return Number.parseInt(raw, 10);
}

export function getTrickResolvedDelayMs(): number {
  return envDelayMs('TRICK_RESOLVED_DELAY_MS', TRICK_RESOLVED_DELAY_MS);
}

export function getAiTurnDelayMs(random: () => number = Math.random): number {
  const min = envDelayMs('AI_TURN_DELAY_MIN_MS', AI_TURN_DELAY_MIN_MS);
  // The upper bound never drops below the lower one, even if only the minimum is overridden.
  const max = Math.max(min, envDelayMs('AI_TURN_DELAY_MAX_MS', AI_TURN_DELAY_MAX_MS));
  return Math.round(min + random() * (max - min));
}

/** How long a session survives after its human disconnected; afterwards it is deleted. */
export const SESSION_TTL_MS = 5 * 60 * 1000;

/** After the game ended the session (result already sent and saved) is dropped after this long. */
export const FINISHED_SESSION_TTL_MS = 5 * 60 * 1000;

/** Upper bound of simultaneously held sessions; `create_room` is refused beyond it. */
export const MAX_SESSIONS = 200;

/** Reads the session limit; `MAX_SESSIONS` env var (a positive integer) overrides the default. */
export function getMaxSessions(): number {
  const raw = process.env.MAX_SESSIONS?.trim();
  if (!raw || !/^\d+$/.test(raw) || Number.parseInt(raw, 10) < 1) return MAX_SESSIONS;
  return Number.parseInt(raw, 10);
}
