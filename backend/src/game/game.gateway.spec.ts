import assert from 'node:assert/strict';
import type { Server, Socket } from 'socket.io';
import { GameGateway } from './game.gateway';
import { GameService } from './game.service';
import { PrismaService } from '../prisma/prisma.service';
import { GAME_EVENTS, SESSION_TTL_MS } from './constants';

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
  return { gateway, service, client, emitted, saved };
}

/** Creates a room whose human seat is driven by the AI too, so a whole game runs on server timers. */
function startAllAiGame() {
  const ctx = setup();
  const { roomId } = (ctx.gateway.handleCreateRoom(ctx.client, { username: 'human' }) as {
    data: { roomId: string };
  }).data;
  const managed = ctx.service.findSession(roomId)!;
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
    const managed = ctx.service.findSession(roomId)!;
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
    const { gateway, service, client, managed, roomId } = startAllAiGame();
    jest.advanceTimersByTime(3000);
    gateway.handleDisconnect(client);
    // No game timer is left; only the session expiry (TTL) timer is pending.
    assert.equal(managed.aiTimers.size, 0);
    assert.equal(managed.resolveTimer, undefined);
    assert.ok(managed.expiryTimer);
    assert.equal(jest.getTimerCount(), 1);
    const snapshot = JSON.stringify(managed.engine.state.players.map((p: any) => p.hand.length));
    jest.advanceTimersByTime(20_000);
    assert.equal(JSON.stringify(managed.engine.state.players.map((p: any) => p.hand.length)), snapshot);

    // The test turned the human seat into an AI, so handleJoinRoom would not find him; resume directly.
    service.bindSocket(managed, client.id);
    (gateway as any).resumeRoom(roomId);
    assert.equal(managed.expiryTimer, undefined);
    assert.ok(jest.getTimerCount() > 0);
    for (let i = 0; i < 2000 && managed.engine.state.phase !== 'GAME_OVER'; i++) {
      jest.advanceTimersByTime(500);
    }
    assert.equal(managed.engine.state.phase, 'GAME_OVER');
  });

  test('leaving the room removes it and clears the timers', () => {
    const { gateway, service, client, managed, roomId } = startAllAiGame();
    jest.advanceTimersByTime(3000);
    gateway.handleLeaveRoom(client, { roomId, playerId: managed.humanPlayerId });
    assert.equal(jest.getTimerCount(), 0);
    assert.equal(service.findSession(roomId) !== undefined, false);
  });
});

describe('Information hiding and identity', () => {
  /** A client whose emits are recorded, so direct (non-broadcast) payloads can be inspected too. */
  function makeClient(id: string) {
    return { id, join: jest.fn(), leave: jest.fn(), emit: jest.fn() } as unknown as Socket & { emit: jest.Mock };
  }

  function startHumanGame() {
    const ctx = setup();
    const client = makeClient('sock-1');
    const { roomId, playerId, rejoinToken } = (ctx.gateway.handleCreateRoom(client, { username: 'human' }) as {
      data: { roomId: string; playerId: string; rejoinToken: string };
    }).data;
    const managed = ctx.service.findSession(roomId)!;
    return { ...ctx, client, roomId, playerId, rejoinToken, managed };
  }

  const handsOf = (players: any[]) => players.filter((p) => p.hand.some((c: any) => !c.hidden));

  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  test('room_created, game_started and state_sync only expose the receiver\'s own hand', () => {
    const { gateway, client, roomId, playerId, emitted, managed } = startHumanGame();
    const created = client.emit.mock.calls.find((c) => c[0] === GAME_EVENTS.ROOM_CREATED)![1];
    assert.equal(handsOf(created.players).length, 0);
    assert.ok(created.players.every((p: any) => !('socketId' in p)));

    gateway.handleStartGame(client, { roomId });
    const started = emitted.find((e) => e.event === GAME_EVENTS.GAME_STARTED)!;
    const startedPlayers = (started.payload as any).players;
    assert.deepEqual(handsOf(startedPlayers).map((p: any) => p.id), [playerId]);
    assert.equal(startedPlayers.find((p: any) => p.id === playerId).hand.length, 10);
    // No game_started payload goes to the room as a whole.
    assert.ok(emitted.filter((e) => e.event === GAME_EVENTS.GAME_STARTED).every((e) => e.room === 'sock-1'));
    // Every state_sync is masked the same way.
    for (const e of emitted.filter((x) => x.event === GAME_EVENTS.STATE_SYNC)) {
      assert.ok(handsOf((e.payload as any).players).every((p: any) => p.id === playerId));
    }
    assert.equal(managed.engine.state.players.length, 5);
  });

  test('room_joined is masked for the joining player', () => {
    const { gateway, roomId, playerId, rejoinToken } = startHumanGame();
    const client2 = makeClient('sock-2');
    gateway.handleJoinRoom(client2, { roomId, rejoinToken });
    const joined = client2.emit.mock.calls.find((c) => c[0] === GAME_EVENTS.ROOM_JOINED)![1];
    assert.equal(joined.playerId, playerId);
    assert.ok(joined.players.every((p: any) => !('socketId' in p)));
    assert.ok(handsOf(joined.players).every((p: any) => p.id === playerId));
  });

  test('the kitty is hidden from everybody but the president', () => {
    const { gateway, client, roomId, playerId, managed } = startHumanGame();
    gateway.handleStartGame(client, { roomId });
    const pub = (id: string) => (gateway as any).publicState(managed, id);
    assert.equal(pub(playerId).kitty.length, 0);
    managed.engine.state.phase = 'KITTY_EXCHANGE';
    managed.engine.state.ownerPlayerId = playerId;
    assert.equal(pub(playerId).kitty.length, 3);
    assert.equal(pub('ai-0').kitty.length, 0);
    assert.equal(pub('').kitty.length, 0);
  });

  test('an unrevealed friend is not exposed', () => {
    const { gateway, client, roomId, playerId, managed } = startHumanGame();
    gateway.handleStartGame(client, { roomId });
    const state = managed.engine.state;
    state.players[2].isFriend = true;
    state.friendIndex = 2;
    state.friendPlayerId = state.players[2].id;
    state.friendRevealed = false;
    const hidden = (gateway as any).publicState(managed, playerId);
    assert.equal(hidden.friendIndex, null);
    assert.equal(hidden.friendPlayerId, undefined);
    assert.ok(hidden.players.every((p: any) => !p.isFriend));

    state.friendRevealed = true;
    const shown = (gateway as any).publicState(managed, playerId);
    assert.equal(shown.friendPlayerId, state.players[2].id);
    assert.equal(shown.players[2].isFriend, true);
  });

  test('get_state masks for the player bound to the socket, not the socket id', () => {
    const { gateway, client, roomId, playerId } = startHumanGame();
    gateway.handleStartGame(client, { roomId });
    client.emit.mockClear();
    gateway.handleGetState(client, { roomId });
    const payload = client.emit.mock.calls.find((c) => c[0] === GAME_EVENTS.STATE_SYNC)![1];
    assert.deepEqual(handsOf(payload.players).map((p: any) => p.id), [playerId]);

    const stranger = makeClient('sock-x');
    gateway.handleGetState(stranger, { roomId });
    const strangerPayload = stranger.emit.mock.calls.find((c) => c[0] === GAME_EVENTS.STATE_SYNC)![1];
    assert.equal(handsOf(strangerPayload.players).length, 0);
  });

  test('a socket cannot act as another player, and playerId may be omitted', () => {
    const { gateway, client, roomId, playerId, managed } = startHumanGame();
    gateway.handleStartGame(client, { roomId });
    const stranger = makeClient('sock-x');
    assert.throws(() => gateway.handlePlaceBid(stranger, { roomId, playerId, pass: true }), /not bound/);
    assert.throws(() => gateway.handlePlaceBid(client, { roomId, playerId: 'ai-0', pass: true }), /not bound/);
    assert.throws(
      () => gateway.handlePlayCard(stranger, { roomId, playerId, cardId: managed.engine.state.players[0].hand[0].id }),
      /not bound/
    );
    assert.equal(managed.engine.state.players[0].hasPassed, false);

    const res = gateway.handlePlaceBid(client, { roomId, pass: true });
    assert.equal(res.ok, true);
    assert.equal(managed.engine.state.players[0].hasPassed, true);
  });

  test('leave_room only works for the player bound to the socket', () => {
    const { gateway, service, roomId, playerId } = startHumanGame();
    gateway.handleLeaveRoom(makeClient('sock-x'), { roomId, playerId });
    assert.equal(service.findSession(roomId) !== undefined, true);
  });

  test('join_room is a rejoin: it needs the rejoin token, never a nickname or room id alone', () => {
    const { gateway, roomId, rejoinToken, managed } = startHumanGame();
    const stranger = makeClient('sock-x');
    assert.throws(() => gateway.handleJoinRoom(stranger, { roomId, rejoinToken: 'nope' }), /Cannot rejoin/);
    assert.throws(() => gateway.handleJoinRoom(stranger, { roomId, rejoinToken: undefined as any }), /Cannot rejoin/);
    assert.equal(managed.humanSocketId, 'sock-1');
    assert.equal((stranger.join as jest.Mock).mock.calls.length, 0);
    // The stolen-nickname path is gone: the rejoin token is the only way in.
    gateway.handleJoinRoom(stranger, { roomId, rejoinToken });
    assert.equal(managed.humanSocketId, 'sock-x');
  });

  test('state_sync carries the server computed playableCardIds only on the viewer\'s turn', () => {
    const { gateway, managed, playerId } = startHumanGame();
    const engine = managed.engine;
    engine.deal();
    assert.deepEqual((gateway as any).publicState(managed, playerId).playableCardIds, []);

    // Fast-forward to the first trick: the human (seat 0) is president and leads.
    engine.state.phase = 'TRICK_PLAYING';
    engine.state.giruda = 'SPADE';
    engine.state.presidentIndex = 0;
    engine.state.currentTrickNumber = 1;
    (engine as any)._trickNumber = 1;
    engine.state.currentTurnIndex = 0;
    const hand = engine.state.players[0].hand;
    const ids = (gateway as any).publicState(managed, playerId).playableCardIds as string[];
    assert.ok(ids.length > 0);
    assert.ok(ids.every((id) => hand.some((c: any) => c.id === id)));
    assert.deepEqual((gateway as any).publicState(managed, 'ai-0').playableCardIds, []);
  });
});

describe('Session lifecycle', () => {
  const makeClient = (id: string) =>
    ({ id, join: jest.fn(), leave: jest.fn(), emit: jest.fn() }) as unknown as Socket & { emit: jest.Mock };

  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  function create() {
    const ctx = setup();
    const client = makeClient('sock-1');
    const { roomId, rejoinToken } = (ctx.gateway.handleCreateRoom(client, { username: 'human' }) as {
      data: { roomId: string; rejoinToken: string };
    }).data;
    return { ...ctx, client, roomId, rejoinToken };
  }

  test('start_game is idempotent: a second call neither redeals nor reschedules', () => {
    const { gateway, service, client, roomId } = create();
    const first = gateway.handleStartGame(client, { roomId });
    assert.deepEqual(first.data, { roomId, alreadyStarted: false });
    const hand = JSON.stringify(service.findSession(roomId)!.engine.state.players[0].hand);
    const second = gateway.handleStartGame(client, { roomId });
    assert.deepEqual(second.data, { roomId, alreadyStarted: true });
    assert.equal(JSON.stringify(service.findSession(roomId)!.engine.state.players[0].hand), hand);
    assert.equal(service.findSession(roomId)!.engine.state.phase, 'BIDDING');
  });

  test('start_game from a socket not bound to the room is rejected', () => {
    const { gateway, service, roomId } = create();
    assert.throws(() => gateway.handleStartGame(makeClient('sock-x'), { roomId }), /not bound/);
    assert.equal(service.findSession(roomId)!.engine.state.phase, 'READY');
  });

  test('the session is deleted with all timers after the disconnect TTL', () => {
    const { gateway, service, client, roomId } = create();
    gateway.handleStartGame(client, { roomId });
    gateway.handleDisconnect(client);
    assert.ok(service.findSession(roomId));
    jest.advanceTimersByTime(SESSION_TTL_MS - 1);
    assert.ok(service.findSession(roomId));
    jest.advanceTimersByTime(1);
    assert.equal(service.findSession(roomId), undefined);
    assert.equal(jest.getTimerCount(), 0);
  });

  test('rejoining before the TTL keeps the session', () => {
    const { gateway, service, client, roomId, rejoinToken } = create();
    gateway.handleStartGame(client, { roomId });
    gateway.handleDisconnect(client);
    jest.advanceTimersByTime(SESSION_TTL_MS - 1000);
    gateway.handleJoinRoom(makeClient('sock-2'), { roomId, rejoinToken });
    jest.advanceTimersByTime(SESSION_TTL_MS * 2);
    assert.ok(service.findSession(roomId));
  });

  test('a stale socket disconnecting after a rejoin does not pause the new connection', () => {
    const { gateway, service, client, roomId, rejoinToken } = create();
    gateway.handleStartGame(client, { roomId });
    gateway.handleJoinRoom(makeClient('sock-2'), { roomId, rejoinToken });
    gateway.handleDisconnect(client);
    assert.equal(service.findSession(roomId)!.humanSocketId, 'sock-2');
    assert.equal(service.findSession(roomId)!.expiryTimer, undefined);
  });
});
