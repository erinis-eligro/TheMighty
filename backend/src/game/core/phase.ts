import { GamePhase } from '../entities/game.entity';

/**
 * Allowed phase transitions of the game state machine.
 * Anything not listed here is rejected by `assertTransition`.
 */
export const ALLOWED_TRANSITIONS: Record<GamePhase, readonly GamePhase[]> = {
  READY: ['DEALING'],
  DEALING: ['BIDDING'],
  // BIDDING -> DEALING: everybody passed, the cards are dealt again.
  BIDDING: ['KITTY_EXCHANGE', 'DEALING'],
  KITTY_EXCHANGE: ['FRIEND_SELECTION'],
  FRIEND_SELECTION: ['TRICK_PLAYING'],
  TRICK_PLAYING: ['TRICK_RESOLVED'],
  TRICK_RESOLVED: ['TRICK_PLAYING', 'ROUND_SCORING'],
  ROUND_SCORING: ['GAME_OVER'],
  GAME_OVER: ['READY'],
};

export class InvalidPhaseTransitionError extends Error {
  constructor(
    public readonly from: GamePhase,
    public readonly to: GamePhase
  ) {
    super(`Invalid phase transition: ${from} -> ${to}`);
    this.name = 'InvalidPhaseTransitionError';
  }
}

export function canTransition(from: GamePhase, to: GamePhase): boolean {
  return ALLOWED_TRANSITIONS[from].includes(to);
}

export function assertTransition(from: GamePhase, to: GamePhase): void {
  if (!canTransition(from, to)) {
    throw new InvalidPhaseTransitionError(from, to);
  }
}
