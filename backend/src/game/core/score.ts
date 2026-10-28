import { isPointCard } from './rules';

export function calculateTrickPoints(plays: { card: { rank: string } }[]): number {
  return plays.reduce((sum, p) => sum + (isPointCard(p.card) ? 1 : 0), 0);
}

export function evaluateGameResult(teamPoints: number, bidScore: number): boolean {
  return teamPoints >= bidScore;
}
