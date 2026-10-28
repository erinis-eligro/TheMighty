import { Injectable, NotFoundException, BadRequestException, Logger, Inject } from '@nestjs/common';
import { v4 as uuidv4 } from 'uuid';
import { PrismaService } from '../prisma/prisma.service';
import { Role, Giruda } from '@prisma/client';
import { Room, GameState, Player, Card, Trick } from './entities/game.entity';
import { SeatPosition } from './constants';
import { GAME_EVENTS } from './constants';
import { CreateRoomDto, JoinRoomDto, PlaceBidDto, PlayCardDto } from './dto/game.dto';

@Injectable()
export class GameService {
  private readonly logger = new Logger(GameService.name);
  private readonly rooms = new Map<string, Room>();

  constructor(private readonly prisma: PrismaService) {}

  createRoom(dto: CreateRoomDto, socketId: string): Room {
    const roomId = uuidv4();
    const playerId = uuidv4();
    const hostPlayer: Player = {
      id: playerId,
      socketId,
      username: dto.username,
      seat: 'bottom',
      hand: [],
      isReady: false,
      isAi: false,
      collectedScoreCards: [],
      score: 0,
      isFriend: false,
      isOwner: true,
    };

    const room: Room = {
      id: roomId,
      hostId: playerId,
      players: new Map([[playerId, hostPlayer]]),
      gameState: null,
      createdAt: new Date(),
    };

    this.rooms.set(roomId, room);
    this.logger.log(`Room created: ${roomId} by ${dto.username} (${playerId})`);
    return room;
  }

  joinRoom(dto: JoinRoomDto, socketId: string): { room: Room; playerId: string } {
    const room = this.rooms.get(dto.roomId);
    if (!room) {
      throw new NotFoundException(`Room ${dto.roomId} not found`);
    }

    if (room.players.size >= 5) {
      throw new BadRequestException('Room is full (max 5 players)');
    }

    const seats: SeatPosition[] = ['top', 'left', 'right', 'center'];
    let assignedSeat: SeatPosition = 'center';
    for (const seat of seats) {
      const taken = Array.from(room.players.values()).some((p) => p.seat === seat);
      if (!taken) {
        assignedSeat = seat;
        break;
      }
    }

    const playerId = uuidv4();
    const player: Player = {
      id: playerId,
      socketId,
      username: dto.username,
      seat: assignedSeat,
      hand: [],
      isReady: false,
      isAi: false,
      collectedScoreCards: [],
      score: 0,
      isFriend: false,
      isOwner: false,
    };

    room.players.set(playerId, player);
    this.logger.log(`Player ${dto.username} (${playerId}) joined room ${dto.roomId} at ${assignedSeat}`);
    return { room, playerId };
  }

  leaveRoom(roomId: string, playerId: string): void {
    const room = this.rooms.get(roomId);
    if (!room) return;
    room.players.delete(playerId);
    if (room.players.size === 0) {
      this.rooms.delete(roomId);
      this.logger.log(`Room ${roomId} deleted (empty)`);
    } else {
      this.logger.log(`Player ${playerId} left room ${roomId}`);
    }
  }

  getRoom(roomId: string): Room {
    const room = this.rooms.get(roomId);
    if (!room) throw new NotFoundException(`Room ${roomId} not found`);
    return room;
  }

  getPlayerSocketId(roomId: string, playerId: string): string {
    const room = this.getRoom(roomId);
    const player = room.players.get(playerId);
    if (!player) throw new NotFoundException(`Player ${playerId} not found in room ${roomId}`);
    return player.socketId;
  }

  listRooms(): Array<{ id: string; playerCount: number; hostId: string }> {
    return Array.from(this.rooms.entries()).map(([id, room]) => ({
      id,
      playerCount: room.players.size,
      hostId: room.hostId,
    }));
  }

  async saveGameHistory(userId: string, role: Role, isWin: boolean, bidScore: number, giruda: Giruda, teamPoints = 0) {
    await this.prisma.gameHistory.create({
      data: { user_id: userId, role, is_win: isWin, bid_score: bidScore, team_points: teamPoints, giruda },
    });
    await this.prisma.user.update({
      where: { id: userId },
      data: {
        total_games: { increment: 1 },
        ...(isWin ? { win_count: { increment: 1 } } : {}),
        ...(!isWin ? { lose_count: { increment: 1 } } : {}),
      },
    });
  }
}
