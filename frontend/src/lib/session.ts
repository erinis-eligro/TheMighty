/**
 * Single-player session credentials. The rejoin token returned by `create_room` is the only way
 * to take the seat back (`join_room`) after a reload/reconnect; it is kept per browser tab.
 */
const KEY = 'mighty.session';

export interface StoredSession {
  roomId: string;
  playerId: string;
  username: string;
  rejoinToken: string;
}

export function saveSession(session: StoredSession): void {
  try {
    sessionStorage.setItem(KEY, JSON.stringify(session));
  } catch {
    // storage unavailable (private mode, SSR): rejoin is simply not offered
  }
}

export function loadSession(): StoredSession | null {
  try {
    const raw = sessionStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as StoredSession) : null;
  } catch {
    return null;
  }
}

export function clearSession(): void {
  try {
    sessionStorage.removeItem(KEY);
  } catch {
    // ignore
  }
}
