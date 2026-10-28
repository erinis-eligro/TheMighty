import { IoAdapter } from '@nestjs/platform-socket.io';
import { ServerOptions } from 'socket.io';

const DEFAULT_CORS_ORIGIN = 'http://localhost:3000';

/** Allowed origins from the CORS_ORIGIN env var (comma separated). `*` allows any origin. */
export function getCorsOrigins(): string | string[] {
  const raw = (process.env.CORS_ORIGIN ?? DEFAULT_CORS_ORIGIN).trim();
  if (raw === '*') return '*';
  return raw
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean);
}

/**
 * Applies the env-based CORS configuration to the Socket.io server.
 * (The @WebSocketGateway decorator is evaluated at import time, before env
 * files are loaded, so CORS cannot be configured there.)
 */
export class CorsIoAdapter extends IoAdapter {
  createIOServer(port: number, options?: ServerOptions) {
    return super.createIOServer(port, { ...options, cors: { origin: getCorsOrigins() } });
  }
}
