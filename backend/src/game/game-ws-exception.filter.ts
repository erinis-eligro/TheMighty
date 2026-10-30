import { ArgumentsHost, Catch, ExceptionFilter, HttpException, Logger } from '@nestjs/common';
import { WsException } from '@nestjs/websockets';
import { Socket } from 'socket.io';
import { GAME_EVENTS } from './constants';
import { GameRuleError } from './core/errors';
import type { Ack, AckError, GameErrorPayload } from './protocol';

function toAckError(exception: unknown): AckError {
  if (exception instanceof WsException) {
    const err = exception.getError();
    if (typeof err === 'string') return { code: 'WS_ERROR', message: err };
    const obj = err as { code?: string; message?: string };
    return { code: obj.code ?? 'WS_ERROR', message: obj.message ?? 'Unknown error' };
  }
  if (exception instanceof HttpException) {
    // e.g. ValidationPipe failures (BadRequestException) or NotFoundException from GameService
    const res = exception.getResponse() as string | { message?: string | string[] };
    const raw = typeof res === 'string' ? res : (res.message ?? exception.message);
    const message = Array.isArray(raw) ? raw.join(', ') : raw;
    const status = exception.getStatus();
    return { code: status === 400 ? 'VALIDATION_ERROR' : status === 404 ? 'NOT_FOUND' : 'HTTP_ERROR', message };
  }
  if (exception instanceof GameRuleError) {
    // Game-rule violations thrown by the engine (e.g. "Not your turn"): the message is for the client.
    return { code: exception.code, message: exception.message };
  }
  return { code: 'INTERNAL_ERROR', message: 'Internal server error' };
}

/**
 * Converts any exception thrown in a gateway handler into
 *  - a `game_error` event sent to the requesting client, and
 *  - an `{ ok: false, error }` ack, if the client supplied an ack callback.
 */
@Catch()
export class GameWsExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(GameWsExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost) {
    const args = host.getArgs();
    const client = host.switchToWs().getClient<Socket>();
    // Nest appends the handler pattern to the args, so the ack callback is not necessarily last.
    const ack = [...args].reverse().find((a): a is (res: Ack) => void => typeof a === 'function');

    const error = toAckError(exception);
    if (error.code === 'INTERNAL_ERROR') {
      // Anything unexpected is a server bug: the client only gets a generic message, the log the original.
      this.logger.error(
        exception instanceof Error ? `Unhandled exception: ${exception.message}` : `Unhandled exception: ${String(exception)}`,
        exception instanceof Error ? exception.stack : undefined
      );
    } else {
      this.logger.warn(`${error.code}: ${error.message}`);
    }

    const payload: GameErrorPayload = error;
    client.emit(GAME_EVENTS.GAME_ERROR, payload);
    ack?.({ ok: false, error });
  }
}
