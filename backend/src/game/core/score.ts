import { isPointCard } from './rules';
import { PlayerRole, PlayerRoundScore, RoundResult, Suit } from '../entities/game.entity';

export function calculateTrickPoints(plays: { card: { rank: string } }[]): number {
  return plays.reduce((sum, p) => sum + (isPointCard(p.card) ? 1 : 0), 0);
}

export function evaluateGameResult(teamPoints: number, bidScore: number): boolean {
  return teamPoints >= bidScore;
}

export function getPlayerRole(playerId: string, ownerPlayerId: string, friendPlayerId?: string | null): PlayerRole {
  if (playerId === ownerPlayerId) return 'OWNER';
  if (friendPlayerId && playerId === friendPlayerId) return 'FRIEND';
  return 'OPPOSER';
}

/**
 * ROUND_SCORING: sums the score cards of the owner team (president + friend)
 * and of the opposition, and decides the winner (teamPoints >= bidScore).
 */
export function scoreRound({
  players,
  ownerPlayerId,
  friendPlayerId,
  bidScore,
  giruda,
}: {
  players: { id: string; collectedScoreCards: unknown[] }[];
  ownerPlayerId: string;
  friendPlayerId?: string | null;
  bidScore: number;
  giruda: Suit | 'NO_GIRUDA';
}): RoundResult {
  const scores: PlayerRoundScore[] = players.map((p) => ({
    playerId: p.id,
    role: getPlayerRole(p.id, ownerPlayerId, friendPlayerId),
    points: p.collectedScoreCards.length,
  }));
  const sumOf = (ownerTeam: boolean) =>
    scores.filter((s) => (s.role !== 'OPPOSER') === ownerTeam).reduce((sum, s) => sum + s.points, 0);
  const teamPoints = sumOf(true);

  return {
    isWin: evaluateGameResult(teamPoints, bidScore),
    bidScore,
    giruda,
    teamPoints,
    opponentPoints: sumOf(false),
    ownerPlayerId,
    friendPlayerId: scores.some((s) => s.role === 'FRIEND') ? (friendPlayerId ?? null) : null,
    players: scores,
  };
}
