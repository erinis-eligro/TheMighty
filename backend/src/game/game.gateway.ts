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
import { GAME_EVENTS } from './constants';
import { SeatPosition } from './constants';
import { GameWsExceptionFilter } from './game-ws-exception.filter';
import { Ack, GAME_NAMESPACE, RoomAckData, RoomIdAckData } from './protocol';
import { CreateRoomDto, JoinRoomDto, PlaceBidDto, PlayCardDto } from './dto/game.dto';
import { Player } from './entities/game.entity';
import {
  GameEngine,
  createInitialGameState,
  selectBid,
  selectCardToPlay,
  generateAiName,
} from './core';
import { Role, Giruda } from '@prisma/client';

interface ManagedRoom {
  engine: GameEngine;
  humanPlayerId: string;
  socketByPlayerId: Map<string, string>;
  aiTimers: Map<string, NodeJS.Timeout>;
}

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
      if (managed.socketByPlayerId.has(client.id)) {
        const playerId = managed.socketByPlayerId.get(client.id)!;
        this.clearAiTimers(roomId);
        this.server.to(roomId).emit(GAME_EVENTS.PLAYER_LEFT, { roomId, playerId });
        break;
      }
    }
  }

  private clearAiTimers(roomId: string) {
    const managed = this.rooms.get(roomId);
    if (!managed) return;
    for (const [, t] of managed.aiTimers) clearTimeout(t);
    managed.aiTimers.clear();
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
      turnPlayerId: engine.state.turnPlayerId,
      currentTrick: engine.state.currentTrick,
      tricks: engine.state.tricks,
      kitty: engine.state.kitty,
      giruda: engine.state.giruda,
      ownerPlayerId: engine.state.ownerPlayerId,
      friendPlayerId: engine.state.friendPlayerId,
      currentBid: engine.state.currentBid,
      bidLeader: engine.state.bidLeader,
      players: engine.state.players.map((p) => ({
        id: p.id,
        username: p.username,
        seat: p.seat,
        isAi: p.isAi,
        hand: p.id === forPlayerId ? p.hand : p.hand.map(() => ({ hidden: true })),
        handCount: p.hand.length,
        trickScore: p.trickScore,
        isFriend: p.isFriend,
        isOwner: p.isOwner,
        bid: p.bid,
      })),
    };
  }

  private broadcastState(managed: ManagedRoom) {
    for (const [playerId, socketId] of managed.socketByPlayerId) {
      this.server.to(socketId).emit(GAME_EVENTS.STATE_SYNC, this.publicState(managed, playerId));
    }
  }

  private scheduleAiTurn(roomId: string, delayMs = 1500) {
    const managed = this.getManaged(roomId);
    const engine = managed.engine;
    const turnPlayer = engine.state.players.find((p) => p.id === engine.state.turnPlayerId);
    if (!turnPlayer || !turnPlayer.isAi) return;

    const existing = managed.aiTimers.get(turnPlayer.id);
    if (existing) clearTimeout(existing);

    const timer = setTimeout(async () => {
      managed.aiTimers.delete(turnPlayer.id);
      try {
        if (engine.state.phase === 'BIDDING') {
          const aiHand = turnPlayer.hand;
          const decision = selectBid({ hand: aiHand, giruda: engine.state.giruda as string, currentBid: engine.state.currentBid });
          const isPass = decision.bid === null;
          engine.placeBid(turnPlayer.id, decision.bid ?? undefined, isPass);
          this.server.to(roomId).emit(GAME_EVENTS.BID_PLACED, {
            roomId,
            playerId: turnPlayer.id,
            bid: decision.bid,
            pass: isPass,
          });
        } else if (engine.state.phase === 'PLAYING') {
          const currentTrickPlays = engine.state.currentTrick?.cards ?? [];
          const winnerOfCurrent = currentTrickPlays.length > 0 ? currentTrickPlays[currentTrickPlays.length - 1] : null;
          const isPartnerWinning = winnerOfCurrent
            ? winnerOfCurrent.playerId === engine.state.ownerPlayerId ||
              winnerOfCurrent.playerId === engine.state.friendPlayerId
            : false;
          const decision = selectCardToPlay({
            hand: turnPlayer.hand,
            leadSuit: engine.state.currentTrick?.leadSuit,
            currentTrickPlays,
            giruda: engine.state.giruda as string,
            turnNumber: engine.state.tricks.length + 1,
            totalTricks: 10,
            isPartnerWinningCurrentTrick: isPartnerWinning,
            mightyCard: { suit: 'SPADE', rank: 'A' },
            jokerCallCard: { suit: 'CLUB', rank: '3' },
          });
          const result = engine.playCard(turnPlayer.id, decision.cardId);
          this.server.to(roomId).emit(GAME_EVENTS.CARD_PLAYED, {
            roomId,
            playerId: turnPlayer.id,
            cardId: decision.cardId,
          });
          if (result.trickComplete && result.trick) {
            this.server.to(roomId).emit(GAME_EVENTS.TURN_COMPLETE, {
              roomId,
              trick: result.trick,
              winnerPlayerId: result.trick.winnerPlayerId,
              points: result.points,
            });
          }
        }
      } catch (e) {
        this.logger.error(`AI turn error: ${(e as Error).message}`);
      } finally {
        this.broadcastState(managed);
        this.scheduleAiTurn(roomId);
      }
    }, delayMs);

    managed.aiTimers.set(turnPlayer.id, timer);
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
        trickScore: 0,
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
    return this.ok<RoomAckData>({ roomId: dto.roomId, playerId: human?.id ?? '' });
  }

  @SubscribeMessage(GAME_EVENTS.LEAVE_ROOM)
  handleLeaveRoom(@ConnectedSocket() client: Socket, @MessageBody() data: { roomId: string; playerId: string }) {
    const managed = this.rooms.get(data.roomId);
    if (managed) {
      managed.socketByPlayerId.delete(data.playerId);
      this.clearAiTimers(data.roomId);
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
    client.emit(GAME_EVENTS.STATE_SYNC, this.publicState(managed, client.id));
    return this.ok<RoomIdAckData>({ roomId: data.roomId });
  }

  @SubscribeMessage(GAME_EVENTS.START_GAME)
  @UsePipes(new ValidationPipe({ whitelist: true, transform: true }))
  handleStartGame(@ConnectedSocket() client: Socket, @MessageBody() data: { roomId: string }) {
    const managed = this.getManaged(data.roomId);
    const engine = managed.engine;

    if (engine.state.phase !== 'LOBBY') {
      throw new WsException({ code: 'GAME_ALREADY_STARTED', message: 'Game already started' });
    }

    engine.deal();
    engine.state.phase = 'BIDDING';
    engine.state.currentBid = 0;
    engine.state.turnPlayerId = engine.state.ownerPlayerId;

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
    if (player.id !== engine.state.turnPlayerId) throw new WsException({ code: 'NOT_YOUR_TURN', message: 'Not your turn' });

    const isPass = dto.pass === true;
    engine.placeBid(dto.playerId, dto.bid, isPass);

    this.server.to(dto.roomId).emit(GAME_EVENTS.BID_PLACED, {
      roomId: dto.roomId,
      playerId: dto.playerId,
      bid: dto.bid,
      pass: isPass,
    });
    this.broadcastState(managed);

    // Check bidding completion: all non-owner have bid/passed once around, simplified: after owner + others act once
    // For MVP, advance to next turn; if AI, let it act.
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
    if (player.id !== engine.state.turnPlayerId) throw new WsException({ code: 'NOT_YOUR_TURN', message: 'Not your turn' });

    const result = engine.playCard(dto.playerId, dto.cardId);

    this.server.to(dto.roomId).emit(GAME_EVENTS.CARD_PLAYED, {
      roomId: dto.roomId,
      playerId: dto.playerId,
      cardId: dto.cardId,
    });

    if (result.trickComplete && result.trick) {
      this.server.to(dto.roomId).emit(GAME_EVENTS.TURN_COMPLETE, {
        roomId: dto.roomId,
        trick: result.trick,
        winnerPlayerId: result.trick.winnerPlayerId,
        points: result.points,
      });
    }

    this.broadcastState(managed);

    if (engine.state.phase === 'ENDED') {
      const { isWin, teamPoints, bidScore } = engine.getResult();
      this.server.to(dto.roomId).emit(GAME_EVENTS.GAME_END, {
        roomId: dto.roomId,
        isWin,
        teamPoints,
        bidScore,
      });
      this.clearAiTimers(dto.roomId);

      const human = engine.state.players.find((p) => p.id === managed.humanPlayerId);
      if (human) {
        this.prisma.user.upsert({
          where: { username: human.username },
          update: {},
          create: { username: human.username },
        }).then((u) => {
          this.prisma.gameHistory.create({
            data: {
              user_id: u.id,
              role: Role.OWNER,
              is_win: isWin,
              bid_score: bidScore,
              giruda: engine.state.giruda as Giruda,
            },
          });
        });
      }
      return this.ok<RoomAckData>({ roomId: dto.roomId, playerId: dto.playerId });
    }

    this.scheduleAiTurn(dto.roomId);

    return this.ok<RoomAckData>({ roomId: dto.roomId, playerId: dto.playerId });
  }
}
