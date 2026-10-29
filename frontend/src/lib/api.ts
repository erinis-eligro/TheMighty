import { BACKEND_URL } from '@/lib/socket';

export interface UserStats {
  username: string;
  totalGames: number;
  wins: number;
  losses: number;
  /** Percentage 0~100. */
  winRate: number;
}

/** Win/lose record of a nickname; `null` when the backend cannot be reached. */
export async function fetchUserStats(username: string, signal?: AbortSignal): Promise<UserStats | null> {
  try {
    const res = await fetch(`${BACKEND_URL.replace(/\/+$/, '')}/stats/${encodeURIComponent(username)}`, { signal });
    return res.ok ? ((await res.json()) as UserStats) : null;
  } catch {
    return null;
  }
}

export type GameRole = 'OWNER' | 'FRIEND' | 'OPPOSER';

export interface GameHistoryEntry {
  id: string;
  role: GameRole;
  isWin: boolean;
  bidScore: number;
  /** Score cards the owner team collected. */
  teamPoints: number;
  /** SPADE | DIAMOND | HEART | CLUB | NO_GIRUDA */
  giruda: string;
  createdAt: string;
}

/** Latest games of a nickname, newest first; empty when the backend cannot be reached. */
export async function fetchRecentGames(username: string, limit = 5, signal?: AbortSignal): Promise<GameHistoryEntry[]> {
  try {
    const res = await fetch(
      `${BACKEND_URL.replace(/\/+$/, '')}/stats/${encodeURIComponent(username)}/history?limit=${limit}`,
      { signal },
    );
    return res.ok ? ((await res.json()) as GameHistoryEntry[]) : [];
  } catch {
    return [];
  }
}
