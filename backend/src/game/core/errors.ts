/**
 * A game-rule violation caused by the player's request (wrong phase, not his turn, illegal card,
 * ...). Its message is meant for the client. Every other exception is an internal bug whose
 * message must not leave the server.
 */
export class GameRuleError extends Error {
  constructor(
    message: string,
    public readonly code: string = 'GAME_ERROR'
  ) {
    super(message);
    this.name = 'GameRuleError';
  }
}
