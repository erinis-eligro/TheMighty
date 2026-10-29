'use client';

import { useEffect } from 'react';
import { useGameStore } from '@/store/useGameStore';
import { ConnectionBanner } from '@/components/ConnectionBanner';

/** Opens the one game socket (owned by the store) for the whole app and shows its connection state. */
export function SocketProvider({ children }: { children: React.ReactNode }) {
  const connect = useGameStore((s) => s.connect);
  const disconnect = useGameStore((s) => s.disconnect);

  useEffect(() => {
    connect();
    return disconnect;
  }, [connect, disconnect]);

  return (
    <>
      <ConnectionBanner />
      {children}
    </>
  );
}
