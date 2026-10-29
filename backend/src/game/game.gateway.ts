import {
  WebSocketGateway,
  WebSocketServer,
  OnGatewayInit,
  OnGatewayConnection,
  OnGatewayDisconnect,
  SubscribeMessage,
  ConnectedSocket,
  MessageBody,
  WsException,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { Logger, UseFilters, UsePipes, ValidationPipe } from '@nestjs/common';
import { GameService } from './game.service';
import { PrismaService } from '../prisma/prisma.service';
import { GAME_EVENTS, TRICK_RESOLVED_DELAY_MS, getAiTurnDelayMs } from './constants';
import { SeatPosition } from './constants';
import { GameWsExceptionFilter } from './game-ws-exception.filter';
import { Ack, GAME_NAMESPACE, RoomAckData, RoomIdAckData } from './protocol';
import { CreateRoomDto, DeclareFriendDto, ExchangeKittyDto, JoinRoomDto, PlaceBidDto, PlayCardDto } from './dto/game.dto';
import { Player, Trick } from './entities/game.entity';
import {
  GameEngine,
  createInitialGameState,
  selectBid,
  selectCardToPlay,
  selectFriendDeclaration,
  selectKittyDiscard,
  type FriendReveal,
  generateAiName,
  TOTAL_TRICKS,
} from './core';
import { Role, Giruda } from '@prisma/client';

interface ManagedRoom {
  engine: GameEngine;
  humanPlayerId: string;
  socketByPlayerId: Map<string, string>;
  aiTimers: Map<string, NodeJS.Timeout>;
  /** True once game_end was sent and the result was persisted (guards against double saves). */
  finished?: boolean;
  /** Fires after TRICK_RESOLVED_DELAY_MS to start the next trick / finish the game. */
  resolveTimer?: NodeJS.Timeout;
  /** Consecutive failed AI steps; the driver gives up after MAX_AI_FAILURES instead of looping on an error. */
  aiFailures?: number;
}

const MAX_AI_FAILURES = 3;
const AI_ACTIVE_PHASES = ['BIDDING', 'KITTY_EXCHANGE', 'FRIEND_SELECTION', 'TRICK_PLAYING'];

// CORS origins are configured via the CORS_ORIGIN env var in main.ts (CorsIoAdapter).
@WebSocketGateway({ namespace: GAME_NAMESPACE })
@UseFilters(new GameWsExceptionFilter())
export class GameGateway implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer() server!: Server;
  private readonly logger = new Logger(GameGateway.name);
  private readonly rooms = new Map<string, ManagedRoom>();

  constructor(
    private readonly gameService: GameService,
    private readonly prisma: PrismaService
  ) {}

  afterInit(server: Server) {
    this.logger.log('Socket.io GameGateway initialized');
  }

  handleConnection(client: Socket) {
    this.logger.log(`Client connected: ${client.id}`);
  }

  handleDisconnect(client: Socket) {
    for (const [roomId, managed] of this.rooms.entries()) {
      // socketByPlayerId is keyed by playerId, so look the player up by socket id.
      const playerId = [...managed.socketByPlayerId.entries()].find(([, socketId]) => socketId === client.id)?.[0];
      if (playerId === undefined) continue;
      // Pause the game: nobody is there to watch. Joining the room again resumes it (see resumeRoom).
      this.clearAiTimers(roomId);
      managed.socketByPlayerId.delete(playerId);
      this.server.to(roomId).emit(GAME_EVENTS.PLAYER_LEFT, { roomId, playerId });
      break;
    }
  }

  private clearAiTimers(roomId: string) {
    const managed = this.rooms.get(roomId);
    if (!managed) return;
    for (const [, t] of managed.aiTimers) clearTimeout(t);
    managed.aiTimers.clear();
    if (managed.resolveTimer) {
      clearTimeout(managed.resolveTimer);
      managed.resolveTimer = undefined;
    }
  }

  private getManaged(roomId: string): ManagedRoom {
    const m = this.rooms.get(roomId);
    if (!m) throw new WsException({ code: 'ROOM_NOT_FOUND', message: `Room ${roomId} not found` });
    return m;
  }

  private ok<T>(data: T): Ack<T> {
    return { ok: true, data };
  }

  private publicState(managed: ManagedRoom, forPlayerId: string) {
    const engine = managed.engine;
    return {
      roomId: engine.state.roomId,
      phase: engine.state.phase,
      currentTurnIndex: engine.state.currentTurnIndex,
      turnPlayerId: engine.state.turnPlayerId,
      currentTrick: engine.state.currentTrick,
      trickHistory: engine.state.trickHistory,
      currentTrickNumber: engine.state.currentTrickNumber,
      leadSuit: engine.state.leadSuit,
      isJokerCallActive: engine.state.isJokerCallActive,
      // The kitty (bottom cards, later the president's discards) is only visible to the president.
      kitty:
        forPlayerId === engine.state.ownerPlayerId && engine.state.phase !== 'BIDDING'
          ? engine.state.kitty
          : [],
      giruda: engine.state.giruda,
      ownerPlayerId: engine.state.ownerPlayerId,
      presidentIndex: engine.state.presidentIndex,
      friendDeclaration: engine.state.friendDeclaration,
      friendIndex: engine.state.friendIndex,
      friendPlayerId: engine.state.friendPlayerId,
      friendRevealed: engine.state.friendRevealed,
      result: engine.state.phase === 'GAME_OVER' ? (engine.state.result ?? null) : null,
      passCount: engine.state.passCount,
      currentBid: engine.state.currentBid,
      highestBid: engine.state.highestBid,
      bidLeader: engine.state.bidLeader,
      players: engine.state.players.map((p) => ({
        id: p.id,
        username: p.username,
        seat: p.seat,
        isAi: p.isAi,
        hand: p.id === forPlayerId ? p.hand : p.hand.map(() => ({ hidden: true })),
        handCount: p.hand.length,
        collectedScoreCards: p.collectedScoreCards,
        score: p.score,
        isFriend: p.isFriend,
        isOwner: p.isOwner,
        bid: p.bid,
        hasPassed: p.hasPassed,
      })),
    };
  }

  private broadcastState(managed: ManagedRoom) {
    for (const [playerId, socketId] of managed.socketByPlayerId) {
      this.server.to(socketId).emit(GAME_EVENTS.STATE_SYNC, this.publicState(managed, playerId));
    }
  }

  /**
   * Auto Turn Driver. If it is an AI's turn, performs exactly one AI action after a random
   * 1~1.5s delay, broadcasts the state and schedules the next step. It stops by itself when the
   * room is gone or finished, in phases without an AI action (e.g. TRICK_RESOLVED, which has its
   * own timer), on a human's turn, and after repeated errors.
   */
  private scheduleAiTurn(roomId: string, delayMs = getAiTurnDelayMs()) {
    const managed = this.rooms.get(roomId);
    if (!managed || managed.finished) return;
    const engine = managed.engine;
    if (!AI_ACTIVE_PHASES.includes(engine.state.phase)) return;
    const turnPlayer = engine.state.players[engine.state.currentTurnIndex];
    if (!turnPlayer || !turnPlayer.isAi) return;
    const turnPlayerId = turnPlayer.id;

    const existing = managed.aiTimers.get(turnPlayerId);
    if (existing) clearTimeout(existing);

    const timer = setTimeout(() => {
      managed.aiTimers.delete(turnPlayerId);
      // The room may have been deleted/finished, or the turn moved on, while the timer was pending.
      if (this.rooms.get(roomId) !== managed || managed.finished) return;
      const current = engine.state.players[engine.state.currentTurnIndex];
      if (!AI_ACTIVE_PHASES.includes(engine.state.phase) || !current?.isAi || current.id !== turnPlayerId) return;

      let failed = false;
      try {
        this.runAiStep(roomId, managed, current);
        managed.aiFailures = 0;
      } catch (e) {
        failed = true;
        managed.aiFailures = (managed.aiFailures ?? 0) + 1;
        this.logger.error(`AI turn error (${managed.aiFailures}/${MAX_AI_FAILURES}): ${(e as Error).message}`);
      }

      this.broadcastState(managed);
      if (engine.state.phase === 'GAME_OVER') {
        this.finishGameIfOver(roomId);
      } else if (!failed || (managed.aiFailures ?? 0) < MAX_AI_FAILURES) {
        this.scheduleAiTurn(roomId);
      }
    }, delayMs);

    managed.aiTimers.set(turnPlayerId, timer);
  }

  /** Performs the current AI player's action for the current phase. Throws on engine errors. */
  private runAiStep(roomId: string, managed: ManagedRoom, turnPlayer: Player) {
    const engine = managed.engine;
    switch (engine.state.phase) {
      case 'BIDDING': {
        const decision = selectBid({ hand: turnPlayer.hand, currentBid: engine.state.highestBid });
        const isPass = decision.bid === null;
        const result = engine.placeBid(turnPlayer.id, {
          pass: isPass,
          score: decision.bid ?? undefined,
          giruda: decision.giruda ?? undefined,
        });
        this.emitBidResult(roomId, turnPlayer.id, decision.bid, decision.giruda, isPass, result);
        break;
      }
      case 'KITTY_EXCHANGE': {
        // The AI president keeps the bid giruda and drops its 3 weakest cards.
        const decision = selectKittyDiscard({
          cards: [...turnPlayer.hand, ...engine.state.kitty],
          giruda: engine.state.giruda as string,
        });
        const result = engine.exchangeKitty(turnPlayer.id, decision);
        this.emitKittyExchanged(roomId, turnPlayer.id, result);
        break;
      }
      case 'FRIEND_SELECTION': {
        const decision = selectFriendDeclaration({
          hand: turnPlayer.hand,
          giruda: engine.state.giruda as string,
        });
        const result = engine.declareFriend(turnPlayer.id, decision);
        this.emitFriendDeclared(roomId, turnPlayer.id, result);
        break;
      }
      case 'TRICK_PLAYING': {
        const currentTrickPlays = engine.state.currentTrick?.cards ?? [];
        // The AI treats the current trick winner as a partner only if it can actually know the team.
        const currentWinner = engine.getCurrentTrickWinner();
        const isPartnerWinning = currentWinner ? engine.isAllyOf(turnPlayer.id, currentWinner.winnerPlayerId) : false;
        const decision = selectCardToPlay({
          hand: turnPlayer.hand,
          leadSuit: engine.state.currentTrick?.leadSuit,
          currentTrickPlays,
          giruda: engine.state.giruda as string,
          trickNumber: engine.state.currentTrickNumber,
          totalTricks: TOTAL_TRICKS,
          isPartnerWinningCurrentTrick: isPartnerWinning,
          mightyCard: engine.mightyCard,
          jokerCallCard: engine.jokerCallCard,
          restrictGirudaLead: engine.restrictsGirudaLead(),
          isJokerCallActive: engine.state.isJokerCallActive,
        });
        const result = engine.playCard(turnPlayer.id, decision.cardId, {
          jokerCall: decision.jokerCall,
          jokerLeadSuit: decision.jokerLeadSuit,
        });
        this.server.to(roomId).emit(GAME_EVENTS.CARD_PLAYED, {
          roomId,
          playerId: turnPlayer.id,
          cardId: decision.cardId,
        });
        if (result.friendRevealed) this.emitFriendRevealed(roomId, result.friendRevealed);
        this.handleTrickResult(roomId, managed, result);
        break;
      }
    }
  }

  /**
   * Restarts whatever the server has to drive after a pause (client reconnected): the AI turn,
   * the pending trick advance, or the game end.
   */
  private resumeRoom(roomId: string) {
    const managed = this.rooms.get(roomId);
    if (!managed || managed.finished) return;
    managed.aiFailures = 0;
    const phase = managed.engine.state.phase;
    if (phase === 'TRICK_RESOLVED') {
      this.scheduleTrickAdvance(roomId, managed);
    } else if (phase === 'GAME_OVER') {
      this.finishGameIfOver(roomId);
    } else {
      this.scheduleAiTurn(roomId);
    }
  }

  /**
   * After a card was played: if it completed the trick the engine is now in
   * TRICK_RESOLVED. Announce the result and let a server timer advance the
   * game after TRICK_RESOLVED_DELAY_MS so clients can see all 5 cards.
   */
  private handleTrickResult(
    roomId: string,
    managed: ManagedRoom,
    result: { trickComplete?: boolean; trick?: Trick; points?: number }
  ) {
    if (!result.trickComplete || !result.trick) return;
    const engine = managed.engine;
    const trick = result.trick;
    const winner = engine.state.players.find((p) => p.id === trick.winnerPlayerId);

    this.server.to(roomId).emit(GAME_EVENTS.TURN_COMPLETE, {
      roomId,
      trick,
      winnerPlayerId: trick.winnerPlayerId,
      points: result.points,
    });
    this.server.to(roomId).emit(GAME_EVENTS.TRICK_RESOLVED, {
      roomId,
      trick,
      trickNumber: trick.trickNumber,
      winnerPlayerId: trick.winnerPlayerId,
      winnerIndex: trick.winnerIndex,
      points: result.points,
      collectedScoreCards: winner?.collectedScoreCards ?? [],
      friendPlayerId: engine.state.friendPlayerId,
    });

    this.scheduleTrickAdvance(roomId, managed);
  }

  /** Starts the next trick (or ends the game) once the TRICK_RESOLVED delay has passed. */
  private scheduleTrickAdvance(roomId: string, managed: ManagedRoom) {
    if (managed.resolveTimer) clearTimeout(managed.resolveTimer);
    managed.resolveTimer = setTimeout(() => {
      managed.resolveTimer = undefined;
      if (this.rooms.get(roomId) !== managed || managed.finished) return;
      const engine = managed.engine;
      try {
        const { gameOver } = engine.advanceAfterTrick();
        this.broadcastState(managed);
        if (gameOver) {
          this.finishGameIfOver(roomId);
        } else {
          this.scheduleAiTurn(roomId);
        }
      } catch (e) {
        this.logger.error(`Trick advance error: ${(e as Error).message}`);
      }
    }, TRICK_RESOLVED_DELAY_MS);
  }

  /**
   * Once the engine reached GAME_OVER (after the last trick resolved) it announces
   * the scored result, stops the AI timers and saves the human's record.
   */
  private finishGameIfOver(roomId: string): void {
    const managed = this.rooms.get(roomId);
    if (!managed || managed.finished) return;
    const engine = managed.engine;
    if (engine.state.phase !== 'GAME_OVER') return;
    managed.finished = true;

    const result = engine.getResult();
    this.clearAiTimers(roomId);

    const human = engine.state.players.find((p) => p.id === managed.humanPlayerId);
    const humanScore = result.players.find((p) => p.playerId === managed.humanPlayerId);
    // The human wins together with his team: owner team wins -> OWNER/FRIEND win, OPPOSER lose.
    const humanWon = humanScore ? (humanScore.role === 'OPPOSER' ? !result.isWin : result.isWin) : result.isWin;
    this.server.to(roomId).emit(GAME_EVENTS.GAME_END, {
      roomId,
      ...result,
      humanRole: humanScore?.role ?? null,
      humanWon,
    });

    if (!human || !humanScore) return;

    this.gameService
      .saveGameHistory(
        human.username,
        Role[humanScore.role],
        humanWon,
        result.bidScore,
        result.giruda as Giruda,
        result.teamPoints
      )
      .catch((e: Error) => this.logger.error(`Failed to save game history for ${human.username}: ${e.message}`, e.stack));
  }

  private emitBidResult(
    roomId: string,
    playerId: string,
    bid: number | null,
    giruda: string | null,
    pass: boolean,
    result: { bidLeader?: string; completed: boolean; redealt: boolean }
  ) {
    this.server.to(roomId).emit(GAME_EVENTS.BID_PLACED, { roomId, playerId, bid, giruda, pass });
    if (result.completed || result.redealt) {
      this.server.to(roomId).emit(GAME_EVENTS.BID_ROUND_COMPLETE, {
        roomId,
        redealt: result.redealt,
        presidentPlayerId: result.completed ? result.bidLeader : null,
      });
    }
  }

  /** Public announcement of the declared condition; who the friend is stays hidden. */
  private emitFriendDeclared(
    roomId: string,
    playerId: string,
    result: { declaration: unknown; friendRevealed?: FriendReveal }
  ) {
    this.server.to(roomId).emit(GAME_EVENTS.FRIEND_DECLARED, {
      roomId,
      playerId,
      declaration: result.declaration,
    });
    if (result.friendRevealed) this.emitFriendRevealed(roomId, result.friendRevealed);
  }

  private emitFriendRevealed(roomId: string, reveal: FriendReveal) {
    this.server.to(roomId).emit(GAME_EVENTS.FRIEND_REVEALED, { roomId, ...reveal });
  }

  /** Public announcement only: the discarded cards are never broadcast. */
  private emitKittyExchanged(
    roomId: string,
    playerId: string,
    result: { giruda: string; bidScore: number }
  ) {
    this.server.to(roomId).emit(GAME_EVENTS.KITTY_EXCHANGED, {
      roomId,
      playerId,
      giruda: result.giruda,
      bidScore: result.bidScore,
    });
  }

  @SubscribeMessage(GAME_EVENTS.CREATE_ROOM)
  @UsePipes(new ValidationPipe({ whitelist: true, transform: true }))
  handleCreateRoom(@ConnectedSocket() client: Socket, @MessageBody() dto: CreateRoomDto) {
    const roomId = this.gameService.createRoom(dto, client.id).id;
    const room = this.gameService.getRoom(roomId);
    const humanId = room.hostId;

    // Build 5 players: human + 4 AI
    const seats: SeatPosition[] = ['bottom', 'top', 'left', 'right', 'center'];
    const players = room.players.values();
    const humanPlayer = players.next().value;

    const allPlayers = [
      { ...humanPlayer, seat: 'bottom', isAi: false },
      ...seats.slice(1).map((seat, i) => ({
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
      })),
    ];

    const giruda = 'NO_GIRUDA' as Giruda;
    const engine = new GameEngine({ players: allPlayers as Player[], giruda });
    engine.state.roomId = roomId;

    const socketByPlayerId = new Map<string, string>([[humanId, client.id]]);
    this.rooms.set(roomId, {
      engine,
      humanPlayerId: humanId,
      socketByPlayerId,
      aiTimers: new Map(),
    });

    client.join(roomId);
    this.server.to(roomId).emit(GAME_EVENTS.ROOM_CREATED, {
      roomId,
      playerId: humanId,
      players: allPlayers,
      giruda,
    });
    this.broadcastState(this.getManaged(roomId));

    this.logger.log(`CREATE_ROOM: ${roomId} human=${humanId}`);
    return this.ok<RoomAckData>({ roomId, playerId: humanId });
  }

  @SubscribeMessage(GAME_EVENTS.JOIN_ROOM)
  @UsePipes(new ValidationPipe({ whitelist: true, transform: true }))
  handleJoinRoom(@ConnectedSocket() client: Socket, @MessageBody() dto: JoinRoomDto) {
    const managed = this.getManaged(dto.roomId);
    client.join(dto.roomId);
    // Spectator/rejoin: map socket to human if matches
    const human = managed.engine.state.players.find((p) => p.username === dto.username && !p.isAi);
    if (human) managed.socketByPlayerId.set(human.id, client.id);

    client.emit(GAME_EVENTS.ROOM_JOINED, {
      roomId: dto.roomId,
      playerId: human?.id ?? '',
      players: managed.engine.state.players,
    });
    this.broadcastState(managed);
    // Rejoining after a disconnect: pick the game up where the server paused it.
    if (human) this.resumeRoom(dto.roomId);
    return this.ok<RoomAckData>({ roomId: dto.roomId, playerId: human?.id ?? '' });
  }

  @SubscribeMessage(GAME_EVENTS.LEAVE_ROOM)
  handleLeaveRoom(@ConnectedSocket() client: Socket, @MessageBody() data: { roomId: string; playerId: string }) {
    const managed = this.rooms.get(data.roomId);
    if (managed) {
      managed.socketByPlayerId.delete(data.playerId);
      this.clearAiTimers(data.roomId);
      // Single-player room: when the human leaves there is nobody left to play for.
      if (data.playerId === managed.humanPlayerId) {
        managed.finished = true;
        this.rooms.delete(data.roomId);
      }
    }
    this.gameService.leaveRoom(data.roomId, data.playerId);
    client.leave(data.roomId);
    this.server.to(data.roomId).emit(GAME_EVENTS.PLAYER_LEFT, {
      roomId: data.roomId,
      playerId: data.playerId,
    });
    return this.ok<RoomAckData>({ roomId: data.roomId, playerId: data.playerId });
  }

  @SubscribeMessage(GAME_EVENTS.GET_STATE)
  handleGetState(@ConnectedSocket() client: Socket, @MessageBody() data: { roomId: string }) {
    const managed = this.getManaged(data.roomId);
    // Mask for the player bound to this socket (a socket id is not a player id).
    let forPlayerId = '';
    for (const [playerId, socketId] of managed.socketByPlayerId) {
      if (socketId === client.id) forPlayerId = playerId;
    }
    client.emit(GAME_EVENTS.STATE_SYNC, this.publicState(managed, forPlayerId));
    return this.ok<RoomIdAckData>({ roomId: data.roomId });
  }

  @SubscribeMessage(GAME_EVENTS.START_GAME)
  @UsePipes(new ValidationPipe({ whitelist: true, transform: true }))
  handleStartGame(@ConnectedSocket() client: Socket, @MessageBody() data: { roomId: string }) {
    const managed = this.getManaged(data.roomId);
    const engine = managed.engine;

    if (engine.state.phase !== 'READY') {
      throw new WsException({ code: 'GAME_ALREADY_STARTED', message: 'Game already started' });
    }

    // The engine owns all phase transitions: READY -> DEALING -> BIDDING.
    engine.deal();

    this.server.to(data.roomId).emit(GAME_EVENTS.DEAL_COMPLETE, {
      roomId: data.roomId,
      players: engine.state.players.map((p) => ({ id: p.id, handCount: p.hand.length })),
    });
    this.server.to(data.roomId).emit(GAME_EVENTS.GAME_STARTED, {
      roomId: data.roomId,
      players: engine.state.players,
    });
    this.broadcastState(managed);
    this.scheduleAiTurn(data.roomId);

    return this.ok<RoomIdAckData>({ roomId: data.roomId });
  }

  @SubscribeMessage(GAME_EVENTS.PLACE_BID)
  @UsePipes(new ValidationPipe({ whitelist: true, transform: true }))
  handlePlaceBid(@ConnectedSocket() client: Socket, @MessageBody() dto: PlaceBidDto) {
    const managed = this.getManaged(dto.roomId);
    const engine = managed.engine;

    const player = engine.state.players.find((p) => p.id === dto.playerId);
    if (!player || player.isAi) throw new WsException({ code: 'INVALID_PLAYER', message: 'Only human can place bid here' });
    if (engine.state.players[engine.state.currentTurnIndex]?.id !== player.id) throw new WsException({ code: 'NOT_YOUR_TURN', message: 'Not your turn' });

    const isPass = dto.pass === true;
    const result = engine.placeBid(dto.playerId, { pass: isPass, score: dto.bid, giruda: dto.giruda });

    this.emitBidResult(dto.roomId, dto.playerId, dto.bid ?? null, dto.giruda ?? null, isPass, result);
    this.broadcastState(managed);

    // The engine decides when bidding ends; if the next turn is an AI, let it act.
    this.scheduleAiTurn(dto.roomId);

    return this.ok<RoomAckData>({ roomId: dto.roomId, playerId: dto.playerId });
  }

  @SubscribeMessage(GAME_EVENTS.EXCHANGE_KITTY)
  @UsePipes(new ValidationPipe({ whitelist: true, transform: true }))
  handleExchangeKitty(@ConnectedSocket() client: Socket, @MessageBody() dto: ExchangeKittyDto) {
    const managed = this.getManaged(dto.roomId);
    const engine = managed.engine;

    // Identity is decided by the server: the socket must be the one bound to dto.playerId.
    const player = engine.state.players.find((p) => p.id === dto.playerId);
    if (!player || player.isAi || managed.socketByPlayerId.get(dto.playerId) !== client.id) {
      throw new WsException({ code: 'INVALID_PLAYER', message: 'Only the human president can exchange the kitty' });
    }
    if (engine.state.phase !== 'KITTY_EXCHANGE') {
      throw new WsException({ code: 'INVALID_PHASE', message: 'Not in kitty exchange phase' });
    }
    if (engine.state.ownerPlayerId !== player.id) {
      throw new WsException({ code: 'NOT_PRESIDENT', message: 'Only the president can exchange the kitty' });
    }

    const result = engine.exchangeKitty(dto.playerId, {
      discardCardIds: dto.discardCardIds,
      giruda: dto.giruda,
      bidScore: dto.bidScore,
    });

    this.emitKittyExchanged(dto.roomId, dto.playerId, result);
    this.broadcastState(managed);

    return this.ok<RoomAckData>({ roomId: dto.roomId, playerId: dto.playerId });
  }

  @SubscribeMessage(GAME_EVENTS.DECLARE_FRIEND)
  @UsePipes(new ValidationPipe({ whitelist: true, transform: true }))
  handleDeclareFriend(@ConnectedSocket() client: Socket, @MessageBody() dto: DeclareFriendDto) {
    const managed = this.getManaged(dto.roomId);
    const engine = managed.engine;

    // Identity is decided by the server: the socket must be the one bound to dto.playerId.
    const player = engine.state.players.find((p) => p.id === dto.playerId);
    if (!player || player.isAi || managed.socketByPlayerId.get(dto.playerId) !== client.id) {
      throw new WsException({ code: 'INVALID_PLAYER', message: 'Only the human president can declare the friend' });
    }
    if (engine.state.phase !== 'FRIEND_SELECTION') {
      throw new WsException({ code: 'INVALID_PHASE', message: 'Not in friend selection phase' });
    }
    if (engine.state.ownerPlayerId !== player.id) {
      throw new WsException({ code: 'NOT_PRESIDENT', message: 'Only the president can declare the friend' });
    }

    const result = engine.declareFriend(dto.playerId, { type: dto.type, suit: dto.suit, rank: dto.rank });

    this.emitFriendDeclared(dto.roomId, dto.playerId, result);
    this.broadcastState(managed);

    // The president leads first; if that is an AI (never for a human president) it acts next.
    this.scheduleAiTurn(dto.roomId);

    return this.ok<RoomAckData>({ roomId: dto.roomId, playerId: dto.playerId });
  }

  @SubscribeMessage(GAME_EVENTS.PLAY_CARD)
  @UsePipes(new ValidationPipe({ whitelist: true, transform: true }))
  handlePlayCard(@ConnectedSocket() client: Socket, @MessageBody() dto: PlayCardDto) {
    const managed = this.getManaged(dto.roomId);
    const engine = managed.engine;

    const player = engine.state.players.find((p) => p.id === dto.playerId);
    if (!player || player.isAi) throw new WsException({ code: 'INVALID_PLAYER', message: 'Only human can play card' });
    if (engine.state.players[engine.state.currentTurnIndex]?.id !== player.id) throw new WsException({ code: 'NOT_YOUR_TURN', message: 'Not your turn' });

    const result = engine.playCard(dto.playerId, dto.cardId, {
      jokerCall: dto.jokerCall,
      jokerLeadSuit: dto.jokerLeadSuit,
    });

    this.server.to(dto.roomId).emit(GAME_EVENTS.CARD_PLAYED, {
      roomId: dto.roomId,
      playerId: dto.playerId,
      cardId: dto.cardId,
    });
    if (result.friendRevealed) this.emitFriendRevealed(dto.roomId, result.friendRevealed);
    this.handleTrickResult(dto.roomId, managed, result);
    this.broadcastState(managed);

    // After a completed trick the phase is TRICK_RESOLVED and this is a no-op;
    // the resolve timer schedules the next AI turn.
    this.scheduleAiTurn(dto.roomId);

    return this.ok<RoomAckData>({ roomId: dto.roomId, playerId: dto.playerId });
  }
}
