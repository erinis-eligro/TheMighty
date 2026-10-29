import { Controller, Get, Param, Query } from '@nestjs/common';
import { DEFAULT_HISTORY_LIMIT, GameHistoryEntry, GameService, UserStats } from './game.service';

const cleanName = (username: string) => username.trim().slice(0, 50);

@Controller('stats')
export class StatsController {
  constructor(private readonly gameService: GameService) {}

  /** Lobby summary of a nickname's record (wins/losses). */
  @Get(':username')
  getStats(@Param('username') username: string): Promise<UserStats> {
    return this.gameService.getUserStats(cleanName(username));
  }

  /** The latest `limit` games of a nickname (default 10, max 50), newest first. */
  @Get(':username/history')
  getHistory(@Param('username') username: string, @Query('limit') limit?: string): Promise<GameHistoryEntry[]> {
    const parsed = Number.parseInt(limit ?? '', 10);
    return this.gameService.getRecentGames(cleanName(username), Number.isNaN(parsed) ? DEFAULT_HISTORY_LIMIT : parsed);
  }
}
