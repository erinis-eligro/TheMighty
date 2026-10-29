import assert from 'node:assert/strict';
import { WsException } from '@nestjs/websockets';
import type { ArgumentsHost } from '@nestjs/common';
import { GameWsExceptionFilter } from './game-ws-exception.filter';

describe('GameWsExceptionFilter', () => {
  test('acks the failure even though Nest appends the handler pattern after the ack callback', () => {
    const client = { emit: jest.fn() };
    const ack = jest.fn();
    // Real argument order of a socket.io handler: (client, data, ack, pattern)
    const host = { getArgs: () => [client, {}, ack, 'place_bid'], switchToWs: () => ({ getClient: () => client }) } as unknown as ArgumentsHost;

    new GameWsExceptionFilter().catch(new WsException({ code: 'INVALID_PLAYER', message: 'nope' }), host);

    assert.deepEqual(ack.mock.calls[0][0], { ok: false, error: { code: 'INVALID_PLAYER', message: 'nope' } });
    assert.equal(client.emit.mock.calls[0][0], 'game_error');
  });

  test('works without an ack callback', () => {
    const client = { emit: jest.fn() };
    const host = { getArgs: () => [client, {}, 'place_bid'], switchToWs: () => ({ getClient: () => client }) } as unknown as ArgumentsHost;
    new GameWsExceptionFilter().catch(new Error('boom'), host);
    assert.equal(client.emit.mock.calls.length, 1);
  });
});
