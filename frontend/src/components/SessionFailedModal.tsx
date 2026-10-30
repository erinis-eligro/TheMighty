'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useGameStore } from '@/store/useGameStore';

/** Shown when the server aborted the game after an unrecoverable error: start a new game or go to the lobby. */
export function SessionFailedModal() {
  const router = useRouter();
  const username = useGameStore((s) => s.username);
  const createRoom = useGameStore((s) => s.createRoom);
  const leaveRoom = useGameStore((s) => s.leaveRoom);
  const [busy, setBusy] = useState(false);

  const goLobby = () => {
    leaveRoom();
    router.push('/lobby');
  };

  const newGame = async () => {
    if (busy || !username) return;
    setBusy(true);
    try {
      // The server already dropped the room; forget it and deal a fresh one for the same nickname.
      leaveRoom();
      if (await createRoom(username)) router.push(`/game/${useGameStore.getState().roomId}`);
      else router.push('/lobby');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div role="alertdialog" aria-modal="true" aria-label="게임 중단" className="fixed inset-0 z-[70] flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
      <div className="bg-white rounded-2xl p-6 md:p-8 w-full max-w-md text-center shadow-2xl">
        <h2 className="text-2xl font-bold text-pastel-dangerText mb-2">게임이 중단되었습니다</h2>
        <p className="text-sm text-pastel-muted mb-6">서버 오류로 게임을 계속할 수 없습니다. 새 게임을 시작해 주세요.</p>
        <div className="flex gap-2">
          <button
            onClick={newGame}
            disabled={busy || !username}
            className="flex-1 py-3 bg-pastel-accentHover text-white rounded-xl font-semibold hover:bg-pastel-accentDeep disabled:opacity-50 transition-colors"
          >
            {busy ? '준비 중...' : '새 게임'}
          </button>
          <button
            onClick={goLobby}
            disabled={busy}
            className="flex-1 py-3 bg-white text-pastel-accentHover border-2 border-pastel-accentHover rounded-xl font-semibold hover:bg-pastel-bg disabled:opacity-50 transition-colors"
          >
            로비로
          </button>
        </div>
      </div>
    </div>
  );
}
