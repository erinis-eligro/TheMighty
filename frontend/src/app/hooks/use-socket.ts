'use client';

import { useEffect, useState } from 'react';
import type { Socket } from 'socket.io-client';
import { createGameSocket } from '@/lib/socket';

export function useSocket(roomId?: string) {
  const [socket, setSocket] = useState<Socket | null>(null);

  useEffect(() => {
    const s = createGameSocket();
    setSocket(s);
    return () => {
      s.disconnect();
    };
  }, []);

  useEffect(() => {
    if (!socket || !roomId) return;
    socket.emit('join_room', { roomId, username: 'Player' });
    return () => {
      socket.emit('leave_room', { roomId, playerId: '' });
    };
  }, [socket, roomId]);

  return socket;
}
