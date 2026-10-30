/**
 * Socket integration test: boots the real Nest app (HTTP + Socket.io `/game` namespace) and plays
 * whole games through `socket.io-client` with a simple bot that only looks at `state_sync`.
 * By default the database is an in-memory fake, so no PostgreSQL is needed. With
 * `E2E_DATABASE_URL` set (a migrated database, e.g. `prisma migrate deploy` first) the real
 * PrismaService is used and the saved GameHistory rows are checked in PostgreSQL.
 * Pacing delays are shortened through the env overrides (see constants.ts).
 */
import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { io, type Socket } from 'socket.io-client';
import { GameModule } from './game.module';
import { PrismaService } from '../prisma/prisma.service';
import { GAME_EVENTS } from './constants';
import { GAME_NAMESPACE, type Ack, type CreateRoomAckData } from './protocol';

jest.setTimeout(30_000);

const REAL_DB_URL = process.env.E2E_DATABASE_URL;
/** Nicknames are unique per run so a reused real database does not skew the counters. */
const RUN = Date.now().toString(36);
const nick = (name: string) => `${name}-${RUN}`;

// ---- in-memory stand-in for the parts of PrismaService that GameService uses ----

interface FakeUser {
  id: string;
  username: string;
  total_games: number;
  win_count: number;
  lose_count: number;
}
interface FakeHistory {
  id: string;
  user_id: string;
  role: string;
  is_win: boolean;
  bid_score: number;
  team_points: number;
  giruda: string;
  created_at: Date;
}
type Increment = { increment: number };

class FakePrisma {
  users: FakeUser[] = [];
  histories: FakeHistory[] = [];
  private seq = 0;

  user = {
    findUnique: async ({ where }: { where: { username: string } }) =>
      this.users.find((u) => u.username === where.username) ?? null,
    upsert: async ({ where, create }: { where: { username: string }; create: { username: string } }) => {
      let user = this.users.find((u) => u.username === where.username);
      if (!user) {
        user = { id: `u${++this.seq}`, username: create.username, total_games: 0, win_count: 0, lose_count: 0 };
        this.users.push(user);
      }
      return user;
    },
    update: async ({ where, data }: { where: { id: string }; data: Partial<Record<keyof FakeUser, Increment>> }) => {
      const user = this.users.find((u) => u.id === where.id)!;
      for (const key of ['total_games', 'win_count', 'lose_count'] as const) {
        user[key] += data[key]?.increment ?? 0;
      }
      return user;
    },
  };

  gameHistory = {
    create: async ({ data }: { data: Omit<FakeHistory, 'id' | 'created_at'> }) => {
      const row = { ...data, id: `h${++this.seq}`, created_at: new Date() };
      this.histories.push(row);
      return row;
    },
    findMany: async ({ where, take }: { where: { user: { username: string } }; take: number }) => {
      const user = this.users.find((u) => u.username === where.user.username);
      return this.histories
        .filter((h) => h.user_id === user?.id)
        .reverse()
        .slice(0, take);
    },
  };

  $transaction = async <T>(fn: (tx: FakePrisma) => Promise<T>): Promise<T> => fn(this);
}

// ---- bot ----

interface PublicCard {
  id: string;
  suit: string;
  rank: string;
  isJoker: boolean;
}
interface StateSync {
  roomId: string;
  phase: string;
  turnPlayerId: string;
  currentTurnIndex: number;
  currentTrick: { cards: unknown[] } | null;
  trickHistory: unknown[];
  currentTrickNumber: number;
  kitty: PublicCard[];
  ownerPlayerId: string;
  friendRevealed: boolean;
  friendIndex: number | null;
  friendPlayerId?: string;
  playableCardIds: string[];
  passCount: number;
  currentBid: number;
  highestBid: unknown;
  result: { isWin: boolean; teamPoints: number } | null;
  players: Array<{ id: string; isFriend: boolean; hand: Array<PublicCard | { hidden: true }>; socketId?: string }>;
}
interface GameEnd {
  isWin: boolean;
  bidScore: number;
  teamPoints: number;
  humanRole: string | null;
  humanWon: boolean;
}

/** How the bot bids: take the presidency (20 no-giruda ends the bidding at once) or always pass. */
type BidMode = 'president' | 'pass';

class Bot {
  readonly states: StateSync[] = [];
  readonly errors: string[] = [];
  readonly actions: string[] = [];
  readonly gameEnd: Promise<GameEnd>;
  private lastKey = '';
  private stopped = false;
  /** Resolves with the state at which the bot stopped acting (see `pauseWhen`); never resolves otherwise. */
  readonly paused: Promise<StateSync>;
  private onStop!: (s: StateSync) => void;

  constructor(
    readonly socket: Socket,
    readonly roomId: string,
    readonly playerId: string,
    private readonly bidMode: BidMode,
    /** The bot stops acting (so the server waits for the human) at the first state matching this. */
    private readonly pauseWhen?: (s: StateSync) => boolean
  ) {
    this.paused = new Promise((resolve) => (this.onStop = resolve));
    this.gameEnd = new Promise<GameEnd>((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error(`game_end timeout; last actions: ${JSON.stringify(this.actions.slice(-5))}; errors: ${JSON.stringify(this.errors)}`)),
        20_000
      );
      socket.on('disconnect', () => clearTimeout(timer));
      socket.on(GAME_EVENTS.GAME_END, (payload: GameEnd) => {
        clearTimeout(timer);
        resolve(payload);
      });
    });
    this.gameEnd.catch(() => undefined);
    socket.on(GAME_EVENTS.GAME_ERROR, (e: { code: string; message: string }) => this.errors.push(`${e.code}: ${e.message}`));
    socket.on(GAME_EVENTS.STATE_SYNC, (s: StateSync) => void this.onState(s));
  }

  private async onState(s: StateSync): Promise<void> {
    this.states.push(s);
    assertMasked(s, this.playerId);
    if (this.stopped) return;
    if (this.pauseWhen?.(s)) {
      this.stopped = true;
      this.onStop(s);
      return;
    }
    const me = s.players.find((p) => p.id === this.playerId)!;
    const hand = me.hand as PublicCard[];
    const key = [s.phase, s.currentTurnIndex, s.currentTrickNumber, s.currentTrick?.cards.length ?? 0, s.passCount, s.currentBid, hand.length, hand[0]?.id].join('|');
    if (key === this.lastKey) return;

    const request = this.nextAction(s, hand);
    if (!request) return;
    this.lastKey = key;
    this.actions.push(`${request.event}@${s.phase}`);
    const ack = (await this.socket.emitWithAck(request.event, { roomId: this.roomId, ...request.payload })) as Ack;
    if (!ack.ok) this.errors.push(`${request.event}: ${ack.error.code} ${ack.error.message}`);
  }

  private nextAction(s: StateSync, hand: PublicCard[]): { event: string; payload: Record<string, unknown> } | null {
    const myTurn = s.turnPlayerId === this.playerId;
    switch (s.phase) {
      case 'BIDDING':
        if (!myTurn) return null;
        return this.bidMode === 'president' && s.highestBid === null
          ? { event: GAME_EVENTS.PLACE_BID, payload: { bid: 20, giruda: 'NO_GIRUDA' } }
          : { event: GAME_EVENTS.PLACE_BID, payload: { pass: true } };
      case 'KITTY_EXCHANGE': {
        if (s.ownerPlayerId !== this.playerId) return null;
        const discard = [...hand, ...s.kitty]
          .filter((c) => !c.isJoker && !(c.suit === 'SPADE' && c.rank === 'A'))
          .slice(0, 3)
          .map((c) => c.id);
        return { event: GAME_EVENTS.EXCHANGE_KITTY, payload: { discardCardIds: discard } };
      }
      case 'FRIEND_SELECTION':
        return s.ownerPlayerId === this.playerId ? { event: GAME_EVENTS.DECLARE_FRIEND, payload: { type: 'MIGHTY' } } : null;
      case 'TRICK_PLAYING': {
        if (!myTurn || s.playableCardIds.length === 0) return null;
        const cardId = s.playableCardIds[0];
        const card = hand.find((c) => c.id === cardId)!;
        const leading = (s.currentTrick?.cards.length ?? 0) === 0;
        return {
          event: GAME_EVENTS.PLAY_CARD,
          payload: { cardId, ...(card.isJoker && leading ? { jokerLeadSuit: 'SPADE' } : {}) },
        };
      }
      default:
        return null;
    }
  }
}

/** The client must never see what the server hides (hands of others, kitty of non-presidents, friend before reveal). */
function assertMasked(s: StateSync, viewerId: string): void {
  for (const p of s.players) {
    assert.equal(p.socketId, undefined, 'socket ids must not be sent');
    if (p.id === viewerId) {
      for (const c of p.hand) assert.ok((c as PublicCard).id !== undefined, 'own hand must be visible');
    } else {
      for (const c of p.hand) assert.deepEqual(c, { hidden: true }, `hand of ${p.id} leaked`);
    }
    if (!s.friendRevealed) assert.equal(p.isFriend, false, 'friend flag leaked before reveal');
  }
  if (!s.friendRevealed) {
    assert.equal(s.friendIndex, null);
    assert.equal(s.friendPlayerId, undefined);
  }
  if (s.ownerPlayerId !== viewerId || s.phase === 'BIDDING') {
    assert.deepEqual(s.kitty, [], 'kitty leaked to a non-president');
  }
}

// ---- harness ----

describe('GameGateway over real sockets', () => {
  let app: INestApplication;
  let baseUrl: string;
  const sockets: Socket[] = [];
  const saved: Record<string, string | undefined> = {};
  const DELAY_ENV = ['AI_TURN_DELAY_MIN_MS', 'AI_TURN_DELAY_MAX_MS', 'TRICK_RESOLVED_DELAY_MS'];

  beforeAll(async () => {
    for (const name of DELAY_ENV) saved[name] = process.env[name];
    process.env.AI_TURN_DELAY_MIN_MS = '1';
    process.env.AI_TURN_DELAY_MAX_MS = '3';
    process.env.TRICK_RESOLVED_DELAY_MS = '3';

    let builder = Test.createTestingModule({ imports: [GameModule] });
    if (REAL_DB_URL) process.env.DATABASE_URL = REAL_DB_URL;
    else builder = builder.overrideProvider(PrismaService).useValue(new FakePrisma());
    const moduleRef = await builder.compile();
    app = moduleRef.createNestApplication({ logger: false });
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    await app.listen(0, '127.0.0.1');
    baseUrl = `http://127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    for (const name of DELAY_ENV) {
      if (saved[name] === undefined) delete process.env[name];
      else process.env[name] = saved[name];
    }
    // let the server process the client disconnects before the app (and its sessions) shut down
    await new Promise((r) => setTimeout(r, 50));
    await app.close();
  });

  afterEach(() => {
    for (const s of sockets.splice(0)) s.disconnect();
  });

  async function connect(): Promise<Socket> {
    const socket = io(`${baseUrl}${GAME_NAMESPACE}`, { transports: ['websocket'], forceNew: true });
    sockets.push(socket);
    await new Promise<void>((resolve, reject) => {
      socket.once('connect', resolve);
      socket.once('connect_error', reject);
    });
    return socket;
  }

  async function startBot(username: string, bidMode: BidMode, pauseWhen?: (s: StateSync) => boolean) {
    const socket = await connect();
    const ack = (await socket.emitWithAck(GAME_EVENTS.CREATE_ROOM, { username })) as Ack<CreateRoomAckData>;
    assert.ok(ack.ok, `create_room failed: ${JSON.stringify(ack)}`);
    const room = ack.data;
    const bot = new Bot(socket, room.roomId, room.playerId, bidMode, pauseWhen);
    const started = (await socket.emitWithAck(GAME_EVENTS.START_GAME, { roomId: room.roomId })) as Ack;
    assert.ok(started.ok);
    return { socket, room, bot };
  }

  const getJson = async <T>(path: string): Promise<T> => (await fetch(`${baseUrl}${path}`)).json() as Promise<T>;

  /** The record is saved right after game_end, so poll the HTTP API (what the lobby shows) until it is there. */
  async function pollStats(username: string, expectedGames: number) {
    for (let i = 0; i < 100; i++) {
      const stats = await getJson<{ totalGames: number; wins: number; losses: number }>(`/stats/${username}`);
      if (stats.totalGames >= expectedGames) {
        assert.equal(stats.totalGames, expectedGames);
        return stats;
      }
      await new Promise((r) => setTimeout(r, 20));
    }
    throw new Error(`game of ${username} was not saved`);
  }

  test('the human plays bid → kitty → friend → 10 tricks as president and the record is saved', async () => {
    const { bot } = await startBot(nick('socket-president'), 'president');
    const end = await bot.gameEnd;

    assert.deepEqual(bot.errors, []);
    assert.ok(end.humanRole === 'OWNER' || end.humanRole === 'FRIEND');
    assert.equal(end.bidScore, 20);
    for (const action of ['place_bid', 'exchange_kitty', 'declare_friend']) {
      assert.ok(bot.actions.some((a) => a.startsWith(action)), `human never sent ${action}`);
    }
    assert.equal(bot.actions.filter((a) => a.startsWith('play_card')).length, 10);

    const final = [...bot.states].reverse().find((s) => s.phase === 'GAME_OVER');
    if (final) {
      assert.equal(final.trickHistory.length, 10);
      assert.ok(final.result);
    }

    const stats = await pollStats(nick('socket-president'), 1);
    assert.equal(stats.wins, end.humanWon ? 1 : 0);
    assert.equal(stats.losses, end.humanWon ? 0 : 1);
    const history = await getJson<Array<{ bidScore: number; teamPoints: number; role: string }>>(`/stats/${nick('socket-president')}/history`);
    assert.equal(history.length, 1);
    assert.equal(history[0].bidScore, 20);
    assert.equal(history[0].teamPoints, end.teamPoints);
    assert.equal(history[0].role, end.humanRole);

    if (REAL_DB_URL) {
      // the row really is in PostgreSQL, tied to the user whose counters were bumped
      const prisma = app.get(PrismaService);
      const user = await prisma.user.findUnique({ where: { username: nick('socket-president') }, include: { game_histories: true } });
      assert.equal(user?.total_games, 1);
      assert.equal(user?.game_histories.length, 1);
      assert.equal(user?.game_histories[0].bid_score, 20);
    }
  });

  test('a human who always passes still gets a complete game (AI president)', async () => {
    const { bot } = await startBot(nick('socket-passer'), 'pass');
    const end = await bot.gameEnd;
    assert.deepEqual(bot.errors, []);
    assert.equal(bot.actions.filter((a) => a.startsWith('play_card')).length, 10);
    assert.equal((await pollStats(nick('socket-passer'), 1)).totalGames, 1);
    assert.equal(typeof end.humanWon, 'boolean');
  });

  test('other sockets cannot act for the human or rejoin without the token', async () => {
    // hold the bot at the human's first bid so the game stays put
    const { socket, room, bot } = await startBot(nick('socket-victim'), 'president', (s) => s.phase === 'BIDDING');
    await bot.paused;

    const intruder = await connect();
    const attempts: Array<[string, Record<string, unknown>]> = [
      [GAME_EVENTS.PLACE_BID, { roomId: room.roomId, playerId: room.playerId, bid: 13, giruda: 'SPADE' }],
      [GAME_EVENTS.PLACE_BID, { roomId: room.roomId, pass: true }],
      [GAME_EVENTS.EXCHANGE_KITTY, { roomId: room.roomId, playerId: room.playerId, discardCardIds: ['0', '1', '2'] }],
      [GAME_EVENTS.DECLARE_FRIEND, { roomId: room.roomId, playerId: room.playerId, type: 'NO_FRIEND' }],
      [GAME_EVENTS.PLAY_CARD, { roomId: room.roomId, playerId: room.playerId, cardId: '0' }],
      [GAME_EVENTS.START_GAME, { roomId: room.roomId }],
      [GAME_EVENTS.JOIN_ROOM, { roomId: room.roomId, rejoinToken: 'not-the-token' }],
    ];
    for (const [event, payload] of attempts) {
      const ack = (await intruder.emitWithAck(event, payload)) as Ack;
      assert.equal(ack.ok, false, `${event} from a foreign socket must be rejected`);
    }
    const guessed = (await intruder.emitWithAck(GAME_EVENTS.PLACE_BID, { roomId: room.roomId, playerId: room.playerId, pass: true })) as Ack;
    assert.equal(guessed.error?.code, 'INVALID_PLAYER');

    // the owner cannot send another playerId either
    const spoof = (await socket.emitWithAck(GAME_EVENTS.PLACE_BID, { roomId: room.roomId, playerId: '11111111-1111-4111-8111-111111111111', pass: true })) as Ack;
    assert.equal(spoof.error?.code, 'INVALID_PLAYER');

    // a foreign socket may not read the state of a room it is not bound to
    const foreignState = (await intruder.emitWithAck(GAME_EVENTS.GET_STATE, { roomId: room.roomId })) as Ack;
    assert.equal(foreignState.ok, false);
    assert.equal(foreignState.error?.code, 'INVALID_PLAYER');

    // missing payloads are validation errors, never internal messages
    for (const event of [GAME_EVENTS.GET_STATE, GAME_EVENTS.START_GAME, GAME_EVENTS.LEAVE_ROOM]) {
      const ack = (await socket.emitWithAck(event)) as Ack;
      assert.equal(ack.ok, false, `${event} without a payload must fail`);
      assert.equal(ack.error?.code, 'VALIDATION_ERROR');
      assert.doesNotMatch(ack.error?.message ?? '', /Cannot read properties/);
    }

    // nothing changed: it is still the human's bid
    const own = new Promise<StateSync>((resolve) => socket.once(GAME_EVENTS.STATE_SYNC, resolve));
    await socket.emitWithAck(GAME_EVENTS.GET_STATE, { roomId: room.roomId });
    const state = await own;
    assert.equal(state.phase, 'BIDDING');
    assert.equal(state.turnPlayerId, room.playerId);
    assert.equal(state.currentBid, 0);
  });

  test('reconnecting with the rejoin token resumes the game where it paused', async () => {
    const { socket, room, bot } = await startBot(
      nick('socket-rejoiner'),
      'president',
      (s) => s.phase === 'TRICK_PLAYING' && s.currentTrickNumber >= 3 && s.playableCardIds.length > 0
    );
    const paused = await bot.paused;
    assert.ok(paused.trickHistory.length >= 2);

    socket.disconnect();
    await new Promise((r) => setTimeout(r, 100));

    const socket2 = await connect();
    const bot2 = new Bot(socket2, room.roomId, room.playerId, 'president');
    const firstState = new Promise<StateSync>((resolve) => socket2.once(GAME_EVENTS.STATE_SYNC, resolve));
    const ack = (await socket2.emitWithAck(GAME_EVENTS.JOIN_ROOM, { roomId: room.roomId, rejoinToken: room.rejoinToken })) as Ack<{ playerId: string }>;
    assert.ok(ack.ok);
    assert.equal(ack.data.playerId, room.playerId);

    const resumed = await firstState;
    assert.equal(resumed.phase, 'TRICK_PLAYING');
    assert.equal(resumed.currentTrickNumber, paused.currentTrickNumber);
    assert.deepEqual(resumed.playableCardIds, paused.playableCardIds);

    const end = await bot2.gameEnd;
    assert.deepEqual(bot2.errors, []);
    assert.equal(typeof end.humanWon, 'boolean');
    assert.equal((await pollStats(nick('socket-rejoiner'), 1)).totalGames, 1);
  });
});
