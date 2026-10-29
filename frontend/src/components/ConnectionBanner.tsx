'use client';

import { useGameStore } from '@/store/useGameStore';

/** Shown while the backend socket is down: the failure reason plus a manual retry. */
export function ConnectionBanner() {
  const isConnected = useGameStore((s) => s.isConnected);
  const connectionError = useGameStore((s) => s.connectionError);
  const retryConnection = useGameStore((s) => s.retryConnection);

  if (isConnected) return null;

  return (
    <div
      role="status"
      className="fixed top-3 left-1/2 -translate-x-1/2 z-50 flex items-center gap-3 rounded-xl bg-red-100 px-4 py-2 text-sm text-red-800 shadow-md"
    >
      <span>
        {connectionError
          ? `서버에 연결할 수 없습니다. 자동으로 다시 시도하는 중... (${connectionError})`
          : '서버에 연결 중...'}
      </span>
      <button
        onClick={retryConnection}
        className="rounded-lg bg-white px-3 py-1 font-semibold text-red-800 hover:bg-red-50"
      >
        다시 시도
      </button>
    </div>
  );
}
