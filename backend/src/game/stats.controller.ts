import { Controller, Get, Param } from '@nestjs/common';
import { GameService, UserStats } from './game.service';

@Controller('stats')
export class StatsController {
  constructor(private readonly gameService: GameService) {}

  /** Lobby summary of a nickname's record (wins/losses). */
  @Get(':username')
  getStats(@Param('username') username: string): Promise<UserStats> {
    return this.gameService.getUserStats(username.trim().slice(0, 50));
  }
}
