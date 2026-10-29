'use client';

import { useEffect, useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { motion } from 'framer-motion';
import { useGameStore } from '@/store/useGameStore';
import { fetchRecentGames, fetchUserStats, type GameHistoryEntry, type UserStats } from '@/lib/api';
import { SuitIcon } from './SuitIcon';
import { ROLE_LABEL } from './ResultModal';
import { loadSession } from '@/lib/session';

const NICKNAME_KEY = 'mighty.nickname';
const MAX_NICKNAME = 50;

export function Lobby() {
  const router = useRouter();
  const isConnected = useGameStore((s) => s.isConnected);
  const error = useGameStore((s) => s.error);
  const createRoom = useGameStore((s) => s.createRoom);
  const rejoinRoom = useGameStore((s) => s.rejoinRoom);
  const leaveRoom = useGameStore((s) => s.leaveRoom);
  const setError = useGameStore((s) => s.setError);

  const [nickname, setNickname] = useState('');
  const [busy, setBusy] = useState(false);
  const [stats, setStats] = useState<UserStats | null>(null);
  const [recent, setRecent] = useState<GameHistoryEntry[]>([]);
  // Read after mount: the stored session is not available during server rendering.
  const [savedRoomId, setSavedRoomId] = useState<string | null>(null);

  useEffect(() => {
    setError(null);
    setNickname(localStorage.getItem(NICKNAME_KEY) ?? loadSession()?.username ?? '');
    setSavedRoomId(loadSession()?.roomId ?? null);
  }, [setError]);

  const name = nickname.trim();

  // Record summary of the typed nickname (debounced).
  useEffect(() => {
    if (!name) {
      setStats(null);
      setRecent([]);
      return;
    }
    const controller = new AbortController();
    const timer = setTimeout(() => {
      fetchUserStats(name, controller.signal).then((s) => {
        if (!controller.signal.aborted) setStats(s);
      });
      fetchRecentGames(name, 5, controller.signal).then((games) => {
        if (!controller.signal.aborted) setRecent(games);
      });
    }, 400);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [name]);

  const startGame = async (e: FormEvent) => {
    e.preventDefault();
    if (!name || busy) return;
    setBusy(true);
    try {
      localStorage.setItem(NICKNAME_KEY, name);
      const ok = await createRoom(name);
      if (ok) router.push(`/game/${useGameStore.getState().roomId}`);
    } finally {
      setBusy(false);
    }
  };

  const resume = async () => {
    if (!savedRoomId || busy) return;
    setBusy(true);
    try {
      const ok = await rejoinRoom(savedRoomId);
      if (ok) router.push(`/game/${savedRoomId}`);
      else setSavedRoomId(null); // the server no longer has the game (expired/finished)
    } finally {
      setBusy(false);
    }
  };

  const discardSaved = () => {
    // Forget the stored game; the server drops the unattended session after its disconnect TTL.
    leaveRoom();
    setSavedRoomId(null);
  };

  return (
    <div className="min-h-screen bg-pastel-bg flex flex-col items-center justify-center p-6">
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="bg-pastel-card rounded-3xl shadow-2xl p-10 w-full max-w-md border border-gray-200"
      >
        <h1 className="text-3xl font-bold text-center text-pastel-text mb-2">마이티 (Mighty)</h1>
        <p className="text-center text-pastel-muted mb-8">한국 전통 트릭테이킹 카드 게임</p>

        <form onSubmit={startGame} className="space-y-3">
          <label htmlFor="nickname" className="block text-sm font-semibold text-pastel-text">
            닉네임
          </label>
          <input
            id="nickname"
            value={nickname}
            onChange={(e) => setNickname(e.target.value)}
            maxLength={MAX_NICKNAME}
            placeholder="닉네임을 입력하세요"
            autoComplete="nickname"
            className="w-full rounded-xl border border-gray-300 px-4 py-3 text-pastel-text focus:border-pastel-accent focus:outline-none"
          />
          <button
            type="submit"
            disabled={!isConnected || !name || busy}
            className="w-full py-4 bg-pastel-accentHover text-white rounded-xl font-semibold hover:bg-pastel-accent disabled:opacity-50 disabled:cursor-not-allowed transition-colors shadow-lg"
          >
            {busy ? '준비 중...' : '게임 시작'}
          </button>
        </form>

        {savedRoomId && (
          <div className="mt-3 flex gap-2">
            <button
              onClick={resume}
              disabled={!isConnected || busy}
              className="flex-1 py-3 bg-pastel-card text-pastel-accentHover border-2 border-pastel-accentHover rounded-xl font-semibold hover:bg-pastel-bg disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              이어하기
            </button>
            <button
              onClick={discardSaved}
              disabled={busy}
              className="px-4 py-3 text-sm text-pastel-muted rounded-xl border border-gray-300 hover:bg-pastel-bg"
            >
              포기
            </button>
          </div>
        )}

        {name && (
          <div className="mt-6 pt-6 border-t border-gray-200" aria-label="전적">
            <p className="text-sm text-pastel-muted mb-1">{name} 님의 전적</p>
            {stats ? (
              <p className="text-pastel-text">
                <span className="font-bold">{stats.totalGames}</span>전{' '}
                <span className="font-bold text-emerald-600">{stats.wins}</span>승{' '}
                <span className="font-bold text-rose-500">{stats.losses}</span>패
                <span className="text-pastel-muted"> (승률 {stats.winRate}%)</span>
              </p>
            ) : (
              <p className="text-sm text-pastel-muted">전적을 불러올 수 없습니다.</p>
            )}
            {recent.length > 0 && (
              <ul className="mt-3 space-y-1" aria-label="최근 게임">
                {recent.map((g) => (
                  <li key={g.id} className="flex items-center justify-between text-xs rounded-lg bg-pastel-bg px-3 py-1.5">
                    <span className={`font-bold ${g.isWin ? 'text-emerald-600' : 'text-rose-500'}`}>{g.isWin ? '승' : '패'}</span>
                    <span className="text-pastel-text">{ROLE_LABEL[g.role]}</span>
                    <span className="text-pastel-muted">
                      <SuitIcon giruda={g.giruda} /> {g.bidScore}점 비딩 / {g.teamPoints}점 획득
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        {error && (
          <div role="alert" className="mt-4 p-3 bg-red-100 rounded-lg text-xs text-red-800">
            {error}
          </div>
        )}
      </motion.div>
    </div>
  );
}
