import assert from 'node:assert/strict';
import type { Server, Socket } from 'socket.io';
import { GameGateway } from './game.gateway';
import { GameService } from './game.service';
import { PrismaService } from '../prisma/prisma.service';
import { GAME_EVENTS } from './constants';

type Emit = { room: string; event: string; payload: unknown };

function setup() {
  const emitted: Emit[] = [];
  const server = {
    to: (room: string) => ({ emit: (event: string, payload: unknown) => emitted.push({ room, event, payload }) }),
  } as unknown as Server;
  const prisma = {} as PrismaService;
  const service = new GameService(prisma);
  const saved: unknown[][] = [];
  service.saveGameHistory = ((...args: unknown[]) => {
    saved.push(args);
    return Promise.resolve();
  }) as unknown as GameService['saveGameHistory'];
  const gateway = new GameGateway(service, prisma);
  (gateway as unknown as { server: Server }).server = server;
  const client = { id: 'sock-1', join: jest.fn(), leave: jest.fn(), emit: jest.fn() } as unknown as Socket;
  return { gateway, client, emitted, saved };
}

/** Creates a room whose human seat is driven by the AI too, so a whole game runs on server timers. */
function startAllAiGame() {
  const ctx = setup();
  const { roomId } = (ctx.gateway.handleCreateRoom(ctx.client, { username: 'human' }) as {
    data: { roomId: string };
  }).data;
  const managed = (ctx.gateway as any).rooms.get(roomId);
  managed.engine.state.players[0].isAi = true;
  ctx.gateway.handleStartGame(ctx.client, { roomId });
  return { ...ctx, roomId, managed };
}

describe('Auto Turn Driver', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  test('drives a whole game to GAME_OVER, sends game_end once and leaves no timers', () => {
    const { emitted, managed, saved } = startAllAiGame();
    for (let i = 0; i < 2000 && managed.engine.state.phase !== 'GAME_OVER'; i++) {
      jest.advanceTimersByTime(500);
    }
    assert.equal(managed.engine.state.phase, 'GAME_OVER');
    assert.equal(emitted.filter((e) => e.event === GAME_EVENTS.GAME_END).length, 1);
    assert.equal(saved.length, 1);
    assert.equal(managed.engine.state.trickHistory.length, 10);
    assert.equal(managed.aiTimers.size, 0);
    assert.equal(managed.resolveTimer, undefined);
    assert.equal(jest.getTimerCount(), 0);
  });

  test('waits for the human on his turn instead of acting for him', () => {
    const ctx = setup();
    const { roomId } = (ctx.gateway.handleCreateRoom(ctx.client, { username: 'human' }) as {
      data: { roomId: string };
    }).data;
    ctx.gateway.handleStartGame(ctx.client, { roomId });
    // The human bids first: nothing to schedule.
    assert.equal(jest.getTimerCount(), 0);
    jest.advanceTimersByTime(10_000);
    const managed = (ctx.gateway as any).rooms.get(roomId);
    assert.equal(managed.engine.state.currentTurnIndex, 0);
    assert.equal(managed.engine.state.phase, 'BIDDING');
  });

  test('an AI step waits 1~1.5s', () => {
    const { managed } = startAllAiGame();
    const bidders = () => managed.engine.state.players.filter((p: any) => p.hasPassed || p.bid).length;
    jest.advanceTimersByTime(999);
    assert.equal(bidders(), 0);
    jest.advanceTimersByTime(501);
    assert.ok(bidders() === 1 || managed.engine.state.phase !== 'BIDDING');
  });

  test('a disconnect stops all timers and rejoining resumes the game', () => {
    const { gateway, client, managed, roomId } = startAllAiGame();
    managed.socketByPlayerId.set(managed.humanPlayerId, client.id);
    jest.advanceTimersByTime(3000);
    gateway.handleDisconnect(client);
    assert.equal(jest.getTimerCount(), 0);
    const snapshot = JSON.stringify(managed.engine.state.players.map((p: any) => p.hand.length));
    jest.advanceTimersByTime(20_000);
    assert.equal(JSON.stringify(managed.engine.state.players.map((p: any) => p.hand.length)), snapshot);

    // The test turned the human seat into an AI, so handleJoinRoom would not find him; resume directly.
    (gateway as any).resumeRoom(roomId);
    assert.ok(jest.getTimerCount() > 0);
    for (let i = 0; i < 2000 && managed.engine.state.phase !== 'GAME_OVER'; i++) {
      jest.advanceTimersByTime(500);
    }
    assert.equal(managed.engine.state.phase, 'GAME_OVER');
  });

  test('leaving the room removes it and clears the timers', () => {
    const { gateway, client, managed, roomId } = startAllAiGame();
    jest.advanceTimersByTime(3000);
    gateway.handleLeaveRoom(client, { roomId, playerId: managed.humanPlayerId });
    assert.equal(jest.getTimerCount(), 0);
    assert.equal((gateway as any).rooms.has(roomId), false);
  });
});
