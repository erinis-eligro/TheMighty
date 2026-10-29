import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { randomUUID, timingSafeEqual } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { Role, Giruda } from '@prisma/client';
import { GameSession, Player } from './entities/game.entity';
import { SEAT_POSITIONS, SESSION_TTL_MS } from './constants';
import { GameEngine, generateAiName } from './core';

/**
 * Owns every game session (the single store of rooms). The gateway is only the transport:
 * it looks sessions up here, and the socket/timer bookkeeping lives on the session.
 */
@Injectable()
export class GameService implements OnModuleDestroy {
  private readonly logger = new Logger(GameService.name);
  private readonly sessions = new Map<string, GameSession>();

  constructor(private readonly prisma: PrismaService) {}

  onModuleDestroy(): void {
    for (const id of [...this.sessions.keys()]) this.deleteSession(id);
  }

  /** Creates a single-player session: the human at `bottom` plus 4 AI players. */
  createSession(username: string, socketId: string): GameSession {
    const roomId = randomUUID();
    const humanPlayerId = randomUUID();
    const human: Player = {
      id: humanPlayerId,
      socketId: '',
      username,
      seat: SEAT_POSITIONS[0],
      hand: [],
      isReady: false,
      isAi: false,
      collectedScoreCards: [],
      score: 0,
      isFriend: false,
      isOwner: false,
    };
    const ais: Player[] = SEAT_POSITIONS.slice(1).map((seat, i) => ({
      id: `ai-${i}`,
      socketId: '',
      username: generateAiName(i),
      seat,
      hand: [],
      isReady: false,
      isAi: true,
      collectedScoreCards: [],
      score: 0,
      isFriend: false,
      isOwner: false,
    }));

    const engine = new GameEngine({ players: [human, ...ais], giruda: 'NO_GIRUDA' });
    engine.state.roomId = roomId;

    const session: GameSession = {
      id: roomId,
      engine,
      humanPlayerId,
      username,
      rejoinToken: randomUUID(),
      humanSocketId: socketId,
      aiTimers: new Map(),
      createdAt: new Date(),
    };
    this.sessions.set(roomId, session);
    this.logger.log(`Session created: ${roomId} by ${username} (${humanPlayerId})`);
    return session;
  }

  findSession(roomId: string): GameSession | undefined {
    return this.sessions.get(roomId);
  }

  findSessionBySocket(socketId: string): GameSession | undefined {
    for (const session of this.sessions.values()) {
      if (session.humanSocketId === socketId) return session;
    }
    return undefined;
  }

  /** Constant-time comparison of the rejoin token the client presented. */
  verifyRejoinToken(session: GameSession, token: string | undefined): boolean {
    if (typeof token !== 'string') return false;
    const expected = Buffer.from(session.rejoinToken);
    const given = Buffer.from(token);
    return expected.length === given.length && timingSafeEqual(expected, given);
  }

  /** Binds a (new) socket to the human seat and cancels a pending disconnect expiry. */
  bindSocket(session: GameSession, socketId: string): void {
    session.humanSocketId = socketId;
    this.cancelExpiry(session);
  }

  /** Unbinds the socket if it is still the bound one (a stale socket is ignored). Returns whether it was. */
  unbindSocket(session: GameSession, socketId: string): boolean {
    if (session.humanSocketId !== socketId) return false;
    session.humanSocketId = undefined;
    return true;
  }

  /** Stops the AI turns and the pending trick advance (e.g. nobody is watching). */
  clearGameTimers(session: GameSession): void {
    for (const t of session.aiTimers.values()) clearTimeout(t);
    session.aiTimers.clear();
    if (session.resolveTimer) {
      clearTimeout(session.resolveTimer);
      session.resolveTimer = undefined;
    }
  }

  /** Deletes the session unless the human rejoins within `ttlMs`. */
  scheduleExpiry(session: GameSession, ttlMs = SESSION_TTL_MS): void {
    this.cancelExpiry(session);
    session.expiryTimer = setTimeout(() => {
      session.expiryTimer = undefined;
      this.logger.log(`Session ${session.id} expired (human disconnected)`);
      this.deleteSession(session.id);
    }, ttlMs);
  }

  private cancelExpiry(session: GameSession): void {
    if (session.expiryTimer) {
      clearTimeout(session.expiryTimer);
      session.expiryTimer = undefined;
    }
  }

  /** Removes the session and clears every timer; pending timer callbacks see `finished` and stop. */
  deleteSession(roomId: string): void {
    const session = this.sessions.get(roomId);
    if (!session) return;
    session.finished = true;
    this.clearGameTimers(session);
    this.cancelExpiry(session);
    this.sessions.delete(roomId);
    this.logger.log(`Session ${roomId} deleted`);
  }

  /**
   * Persists one finished game for a user: upserts the user, appends the
   * GameHistory row and updates the win/lose counters in a single transaction.
   */
  async saveGameHistory(
    username: string,
    role: Role,
    isWin: boolean,
    bidScore: number,
    giruda: Giruda,
    teamPoints = 0
  ): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const user = await tx.user.upsert({
        where: { username },
        update: {},
        create: { username },
      });
      await tx.gameHistory.create({
        data: { user_id: user.id, role, is_win: isWin, bid_score: bidScore, team_points: teamPoints, giruda },
      });
      await tx.user.update({
        where: { id: user.id },
        data: {
          total_games: { increment: 1 },
          ...(isWin ? { win_count: { increment: 1 } } : { lose_count: { increment: 1 } }),
        },
      });
    });
  }
}
