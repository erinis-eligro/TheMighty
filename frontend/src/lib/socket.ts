import { io, type Socket } from 'socket.io-client';
import { GAME_NAMESPACE, type Ack } from '@/types/protocol';

const BACKEND_URL = process.env.NEXT_PUBLIC_BACKEND_URL ?? 'http://localhost:3001';

/** Connects to the backend `/game` namespace (must match GameGateway's namespace). */
export function createGameSocket(url: string = BACKEND_URL): Socket {
  return io(`${url.replace(/\/+$/, '')}${GAME_NAMESPACE}`, {
    transports: ['websocket', 'polling'],
  });
}

/** Emits an event and resolves with the `{ ok, data, error }` ack envelope. */
export function emitWithAck<T = unknown>(
  socket: Socket,
  event: string,
  payload: unknown,
  timeoutMs = 5000,
): Promise<Ack<T>> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      resolve({ ok: false, error: { code: 'TIMEOUT', message: '서버 응답 시간이 초과되었습니다.' } });
    }, timeoutMs);
    socket.emit(event, payload, (res: Ack<T>) => {
      clearTimeout(timer);
      resolve(res);
    });
  });
}
