import { io, type Socket } from 'socket.io-client';
import {
  GAME_NAMESPACE,
  type Ack,
  type ClientToServerEvents,
  type ServerToClientEvents,
  type SyncStateBase,
} from '@/types/protocol';

export const BACKEND_URL = process.env.NEXT_PUBLIC_BACKEND_URL ?? 'http://localhost:3001';

/** Typed socket: `S` is the masked game state carried by `state_sync`. */
export type GameSocket<S extends SyncStateBase = SyncStateBase> = Socket<ServerToClientEvents<S>, ClientToServerEvents>;

/** Connects to the backend `/game` namespace (must match GameGateway's namespace). */
export function createGameSocket<S extends SyncStateBase = SyncStateBase>(url: string = BACKEND_URL): GameSocket<S> {
  return io(`${url.replace(/\/+$/, '')}${GAME_NAMESPACE}`, {
    transports: ['websocket', 'polling'],
  });
}

/** Emits a request and resolves with the `{ ok, data, error }` ack envelope. */
export function emitWithAck<S extends SyncStateBase, E extends keyof ClientToServerEvents>(
  socket: GameSocket<S>,
  event: E,
  payload: Parameters<ClientToServerEvents[E]>[0],
  timeoutMs = 5000,
): Promise<AckOf<E>> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      resolve({ ok: false, error: { code: 'TIMEOUT', message: '서버 응답 시간이 초과되었습니다.' } });
    }, timeoutMs);
    const onAck = (res: AckOf<E>) => {
      clearTimeout(timer);
      resolve(res);
    };
    // The tuple of overloads of a generic event cannot be inferred by TS; the signature above is the contract.
    (socket.emit as (event: E, payload: unknown, ack: (res: AckOf<E>) => void) => void)(event, payload, onAck);
  });
}

/** Ack envelope of a request event. */
type AckOf<E extends keyof ClientToServerEvents> = Ack<AckDataOf<ClientToServerEvents[E]>>;
type AckDataOf<F> = F extends (payload: never, ack?: (res: Ack<infer T>) => void) => void ? T : never;
