'use client';

import { useEffect, useState } from 'react';
import { io } from 'socket.io-client';

const BACKEND_URL = process.env.NEXT_PUBLIC_BACKEND_URL ?? 'http://localhost:3001';

export function useSocket(roomId?: string) {
  const [socket, setSocket] = useState<ReturnType<typeof io> | null>(null);

  useEffect(() => {
    const s = io(BACKEND_URL, { transports: ['websocket', 'polling'] });
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
