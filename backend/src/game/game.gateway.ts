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
import { Namespace, Server, Socket } from 'socket.io';
import { Logger, UseFilters, UsePipes, ValidationPipe } from '@nestjs/common';
import { GameService } from './game.service';
import { PrismaService } from '../prisma/prisma.service';
import { GAME_EVENTS, TRICK_RESOLVED_DELAY_MS, getAiTurnDelayMs } from './constants';
import { GameWsExceptionFilter } from './game-ws-exception.filter';
import { Ack, CreateRoomAckData, GAME_NAMESPACE, RoomAckData, RoomIdAckData, StartGameAckData } from './protocol';
import { CreateRoomDto, DeclareFriendDto, ExchangeKittyDto, JoinRoomDto, PlaceBidDto, PlayCardDto } from './dto/game.dto';
import { GameSession, Player, Trick } from './entities/game.entity';
import {
  selectBid,
  selectCardToPlay,
  selectFriendDeclaration,
  selectKittyDiscard,
  type FriendReveal,
  TOTAL_TRICKS,
} from './core';
import { Role, Giruda } from '@prisma/client';

const MAX_AI_FAILURES = 3;
const AI_ACTIVE_PHASES = ['BIDDING', 'KITTY_EXCHANGE', 'FRIEND_SELECTION', 'TRICK_PLAYING'];

// CORS origins are configured via the CORS_ORIGIN env var in main.ts (CorsIoAdapter).
@WebSocketGateway({ namespace: GAME_NAMESPACE })
@UseFilters(new GameWsExceptionFilter())
export class GameGateway implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer() server!: Server;
  private readonly logger = new Logger(GameGateway.name);

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
    const session = this.gameService.findSessionBySocket(client.id);
    if (!session) return;
    // Pause the game: nobody is there to watch. Rejoining resumes it (see resumeRoom); if the human
    // does not come back within SESSION_TTL_MS the service deletes the session.
    this.gameService.unbindSocket(session, client.id);
    this.gameService.clearGameTimers(session);
    this.gameService.scheduleExpiry(session);
    this.server.to(session.id).emit(GAME_EVENTS.PLAYER_LEFT, { roomId: session.id, playerId: session.humanPlayerId });
  }

  private getManaged(roomId: string): GameSession {
    const m = this.gameService.findSession(roomId);
    if (!m) throw new WsException({ code: 'ROOM_NOT_FOUND', message: `Room ${roomId} not found` });
    return m;
  }

  /** The `server` of a namespace gateway is the Namespace itself (it owns the connected sockets). */
  private get namespace(): Namespace {
    return this.server as unknown as Namespace;
  }

  /** The player bound to this socket, if any (a socket id is not a player id). */
  private boundPlayerId(managed: GameSession, client: Socket): string | undefined {
    return managed.humanSocketId === client.id ? managed.humanPlayerId : undefined;
  }

  private ok<T>(data: T): Ack<T> {
    return { ok: true, data };
  }

  /** Players as `forPlayerId` may see them: only his own hand, no socket ids, friend flag only once revealed. */
  private maskedPlayers(managed: GameSession, forPlayerId: string) {
    const engine = managed.engine;
    return engine.state.players.map((p) => ({
      id: p.id,
      username: p.username,
      seat: p.seat,
      isAi: p.isAi,
      hand: p.id === forPlayerId ? p.hand : p.hand.map(() => ({ hidden: true })),
      handCount: p.hand.length,
      collectedScoreCards: p.collectedScoreCards,
      score: p.score,
      isFriend: engine.state.friendRevealed && p.isFriend,
      isOwner: p.isOwner,
      bid: p.bid,
      hasPassed: p.hasPassed,
    }));
  }

  /**
   * Identity is decided by the server: the player bound to this socket. A `playerId` sent by the
   * client is never trusted; if present it must match the bound player.
   */
  private resolveHumanPlayer(managed: GameSession, client: Socket, requestedPlayerId?: string): Player {
    const playerId = this.boundPlayerId(managed, client);
    const player = playerId === undefined ? undefined : managed.engine.state.players.find((p) => p.id === playerId);
    if (!player || player.isAi || (requestedPlayerId !== undefined && requestedPlayerId !== player.id)) {
      throw new WsException({ code: 'INVALID_PLAYER', message: 'This socket is not bound to that player' });
    }
    return player;
  }

  /** Sends one event to every bound socket with a payload masked for that socket's player. */
  private emitMasked(managed: GameSession, event: string, build: (playerId: string) => unknown) {
    if (managed.humanSocketId) {
      this.server.to(managed.humanSocketId).emit(event, build(managed.humanPlayerId));
    }
  }

  private publicState(managed: GameSession, forPlayerId: string) {
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
      // Who the friend is stays hidden until the friend is revealed.
      friendIndex: engine.state.friendRevealed ? engine.state.friendIndex : null,
      friendPlayerId: engine.state.friendRevealed ? engine.state.friendPlayerId : undefined,
      friendRevealed: engine.state.friendRevealed,
      // Legal plays of the viewer (empty unless it is his turn); drives the UI card highlight.
      playableCardIds: engine.getPlayableCardIds(forPlayerId),
      result: engine.state.phase === 'GAME_OVER' ? (engine.state.result ?? null) : null,
      passCount: engine.state.passCount,
      currentBid: engine.state.currentBid,
      highestBid: engine.state.highestBid,
      bidLeader: engine.state.bidLeader,
      players: this.maskedPlayers(managed, forPlayerId),
    };
  }

  private broadcastState(managed: GameSession) {
    this.emitMasked(managed, GAME_EVENTS.STATE_SYNC, (playerId) => this.publicState(managed, playerId));
  }

  /**
   * Auto Turn Driver. If it is an AI's turn, performs exactly one AI action after a random
   * 1~1.5s delay, broadcasts the state and schedules the next step. It stops by itself when the
   * room is gone or finished, in phases without an AI action (e.g. TRICK_RESOLVED, which has its
   * own timer), on a human's turn, and after repeated errors.
   */
  private scheduleAiTurn(roomId: string, delayMs = getAiTurnDelayMs()) {
    const managed = this.gameService.findSession(roomId);
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
      if (this.gameService.findSession(roomId) !== managed || managed.finished) return;
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
  private runAiStep(roomId: string, managed: GameSession, turnPlayer: Player) {
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
          discarded: engine.state.kitty,
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
          context: {
            role: engine.getTeamRole(turnPlayer.id),
            playedCards: engine.getPlayedCards(),
            friendDeclaration: engine.state.friendDeclaration,
          },
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
    const managed = this.gameService.findSession(roomId);
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
    managed: GameSession,
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
      friendPlayerId: engine.state.friendRevealed ? engine.state.friendPlayerId : undefined,
    });

    this.scheduleTrickAdvance(roomId, managed);
  }

  /** Starts the next trick (or ends the game) once the TRICK_RESOLVED delay has passed. */
  private scheduleTrickAdvance(roomId: string, managed: GameSession) {
    if (managed.resolveTimer) clearTimeout(managed.resolveTimer);
    managed.resolveTimer = setTimeout(() => {
      managed.resolveTimer = undefined;
      if (this.gameService.findSession(roomId) !== managed || managed.finished) return;
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
    const managed = this.gameService.findSession(roomId);
    if (!managed || managed.finished) return;
    const engine = managed.engine;
    if (engine.state.phase !== 'GAME_OVER') return;
    managed.finished = true;

    const result = engine.getResult();
    this.gameService.clearGameTimers(managed);

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
    const session = this.gameService.createSession(dto.username, client.id);
    const roomId = session.id;
    const humanId = session.humanPlayerId;

    client.join(roomId);
    client.emit(GAME_EVENTS.ROOM_CREATED, {
      roomId,
      playerId: humanId,
      players: this.maskedPlayers(session, humanId),
      giruda: session.engine.state.giruda,
    });
    this.broadcastState(session);

    this.logger.log(`CREATE_ROOM: ${roomId} human=${humanId}`);
    return this.ok<CreateRoomAckData>({ roomId, playerId: humanId, rejoinToken: session.rejoinToken });
  }

  /**
   * Single-player rejoin: binds this (new) socket to the session's human seat. The caller must
   * present the rejoin token handed out by create_room; a room id (or nickname) alone is not enough.
   */
  @SubscribeMessage(GAME_EVENTS.JOIN_ROOM)
  @UsePipes(new ValidationPipe({ whitelist: true, transform: true }))
  handleJoinRoom(@ConnectedSocket() client: Socket, @MessageBody() dto: JoinRoomDto) {
    const managed = this.getManaged(dto.roomId);
    if (!this.gameService.verifyRejoinToken(managed, dto.rejoinToken)) {
      throw new WsException({ code: 'INVALID_REJOIN_TOKEN', message: 'Cannot rejoin this room' });
    }
    const humanId = managed.humanPlayerId;

    // A previous socket (e.g. another tab) loses the seat: it must stop receiving the room's events.
    const previous = managed.humanSocketId;
    if (previous && previous !== client.id) this.namespace.sockets?.get(previous)?.leave(dto.roomId);
    this.gameService.bindSocket(managed, client.id);
    client.join(dto.roomId);

    client.emit(GAME_EVENTS.ROOM_JOINED, {
      roomId: dto.roomId,
      playerId: humanId,
      players: this.maskedPlayers(managed, humanId),
    });
    this.broadcastState(managed);
    // Rejoining after a disconnect: pick the game up where the server paused it.
    this.resumeRoom(dto.roomId);
    return this.ok<RoomAckData>({ roomId: dto.roomId, playerId: humanId });
  }

  @SubscribeMessage(GAME_EVENTS.LEAVE_ROOM)
  handleLeaveRoom(@ConnectedSocket() client: Socket, @MessageBody() data: { roomId: string; playerId: string }) {
    const managed = this.gameService.findSession(data.roomId);
    // Identity is decided by the server: only the player bound to this socket may leave as that player.
    if (managed && this.boundPlayerId(managed, client) === data.playerId) {
      // Single-player room: when the human leaves there is nobody left to play for.
      this.gameService.deleteSession(data.roomId);
      this.server.to(data.roomId).emit(GAME_EVENTS.PLAYER_LEFT, {
        roomId: data.roomId,
        playerId: data.playerId,
      });
    }
    client.leave(data.roomId);
    return this.ok<RoomAckData>({ roomId: data.roomId, playerId: data.playerId });
  }

  @SubscribeMessage(GAME_EVENTS.GET_STATE)
  handleGetState(@ConnectedSocket() client: Socket, @MessageBody() data: { roomId: string }) {
    const managed = this.getManaged(data.roomId);
    // Mask for the player bound to this socket (a socket id is not a player id).
    client.emit(GAME_EVENTS.STATE_SYNC, this.publicState(managed, this.boundPlayerId(managed, client) ?? ''));
    return this.ok<RoomIdAckData>({ roomId: data.roomId });
  }

  /** Idempotent: only the first call in READY deals; later calls (reload, re-render) change nothing. */
  @SubscribeMessage(GAME_EVENTS.START_GAME)
  @UsePipes(new ValidationPipe({ whitelist: true, transform: true }))
  handleStartGame(@ConnectedSocket() client: Socket, @MessageBody() data: { roomId: string }) {
    const managed = this.getManaged(data.roomId);
    const engine = managed.engine;

    if (!this.boundPlayerId(managed, client)) {
      throw new WsException({ code: 'INVALID_PLAYER', message: 'This socket is not bound to that room' });
    }

    if (engine.state.phase !== 'READY') {
      client.emit(GAME_EVENTS.STATE_SYNC, this.publicState(managed, managed.humanPlayerId));
      return this.ok<StartGameAckData>({ roomId: data.roomId, alreadyStarted: true });
    }

    // The engine owns all phase transitions: READY -> DEALING -> BIDDING.
    engine.deal();

    this.server.to(data.roomId).emit(GAME_EVENTS.DEAL_COMPLETE, {
      roomId: data.roomId,
      players: engine.state.players.map((p) => ({ id: p.id, handCount: p.hand.length })),
    });
    this.emitMasked(managed, GAME_EVENTS.GAME_STARTED, (playerId) => ({
      roomId: data.roomId,
      players: this.maskedPlayers(managed, playerId),
    }));
    this.broadcastState(managed);
    this.scheduleAiTurn(data.roomId);

    return this.ok<StartGameAckData>({ roomId: data.roomId, alreadyStarted: false });
  }

  @SubscribeMessage(GAME_EVENTS.PLACE_BID)
  @UsePipes(new ValidationPipe({ whitelist: true, transform: true }))
  handlePlaceBid(@ConnectedSocket() client: Socket, @MessageBody() dto: PlaceBidDto) {
    const managed = this.getManaged(dto.roomId);
    const engine = managed.engine;

    const player = this.resolveHumanPlayer(managed, client, dto.playerId);
    if (engine.state.players[engine.state.currentTurnIndex]?.id !== player.id) throw new WsException({ code: 'NOT_YOUR_TURN', message: 'Not your turn' });

    const isPass = dto.pass === true;
    const result = engine.placeBid(player.id, { pass: isPass, score: dto.bid, giruda: dto.giruda });

    this.emitBidResult(dto.roomId, player.id, dto.bid ?? null, dto.giruda ?? null, isPass, result);
    this.broadcastState(managed);

    // The engine decides when bidding ends; if the next turn is an AI, let it act.
    this.scheduleAiTurn(dto.roomId);

    return this.ok<RoomAckData>({ roomId: dto.roomId, playerId: player.id });
  }

  @SubscribeMessage(GAME_EVENTS.EXCHANGE_KITTY)
  @UsePipes(new ValidationPipe({ whitelist: true, transform: true }))
  handleExchangeKitty(@ConnectedSocket() client: Socket, @MessageBody() dto: ExchangeKittyDto) {
    const managed = this.getManaged(dto.roomId);
    const engine = managed.engine;

    const player = this.resolveHumanPlayer(managed, client, dto.playerId);
    if (engine.state.phase !== 'KITTY_EXCHANGE') {
      throw new WsException({ code: 'INVALID_PHASE', message: 'Not in kitty exchange phase' });
    }
    if (engine.state.ownerPlayerId !== player.id) {
      throw new WsException({ code: 'NOT_PRESIDENT', message: 'Only the president can exchange the kitty' });
    }

    const result = engine.exchangeKitty(player.id, {
      discardCardIds: dto.discardCardIds,
      giruda: dto.giruda,
      bidScore: dto.bidScore,
    });

    this.emitKittyExchanged(dto.roomId, player.id, result);
    this.broadcastState(managed);

    return this.ok<RoomAckData>({ roomId: dto.roomId, playerId: player.id });
  }

  @SubscribeMessage(GAME_EVENTS.DECLARE_FRIEND)
  @UsePipes(new ValidationPipe({ whitelist: true, transform: true }))
  handleDeclareFriend(@ConnectedSocket() client: Socket, @MessageBody() dto: DeclareFriendDto) {
    const managed = this.getManaged(dto.roomId);
    const engine = managed.engine;

    const player = this.resolveHumanPlayer(managed, client, dto.playerId);
    if (engine.state.phase !== 'FRIEND_SELECTION') {
      throw new WsException({ code: 'INVALID_PHASE', message: 'Not in friend selection phase' });
    }
    if (engine.state.ownerPlayerId !== player.id) {
      throw new WsException({ code: 'NOT_PRESIDENT', message: 'Only the president can declare the friend' });
    }

    const result = engine.declareFriend(player.id, { type: dto.type, suit: dto.suit, rank: dto.rank });

    this.emitFriendDeclared(dto.roomId, player.id, result);
    this.broadcastState(managed);

    // The president leads first; if that is an AI (never for a human president) it acts next.
    this.scheduleAiTurn(dto.roomId);

    return this.ok<RoomAckData>({ roomId: dto.roomId, playerId: player.id });
  }

  @SubscribeMessage(GAME_EVENTS.PLAY_CARD)
  @UsePipes(new ValidationPipe({ whitelist: true, transform: true }))
  handlePlayCard(@ConnectedSocket() client: Socket, @MessageBody() dto: PlayCardDto) {
    const managed = this.getManaged(dto.roomId);
    const engine = managed.engine;

    const player = this.resolveHumanPlayer(managed, client, dto.playerId);
    if (engine.state.players[engine.state.currentTurnIndex]?.id !== player.id) throw new WsException({ code: 'NOT_YOUR_TURN', message: 'Not your turn' });

    const result = engine.playCard(player.id, dto.cardId, {
      jokerCall: dto.jokerCall,
      jokerLeadSuit: dto.jokerLeadSuit,
    });

    this.server.to(dto.roomId).emit(GAME_EVENTS.CARD_PLAYED, {
      roomId: dto.roomId,
      playerId: player.id,
      cardId: dto.cardId,
    });
    if (result.friendRevealed) this.emitFriendRevealed(dto.roomId, result.friendRevealed);
    this.handleTrickResult(dto.roomId, managed, result);
    this.broadcastState(managed);

    // After a completed trick the phase is TRICK_RESOLVED and this is a no-op;
    // the resolve timer schedules the next AI turn.
    this.scheduleAiTurn(dto.roomId);

    return this.ok<RoomAckData>({ roomId: dto.roomId, playerId: player.id });
  }
}
