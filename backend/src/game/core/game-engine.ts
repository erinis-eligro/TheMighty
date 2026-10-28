import { Card, Player, GameState, Trick } from '../entities/game.entity';
import { SeatPosition } from '../constants';
import { createDeck, shuffleDeck, validateDeck } from './deck';
import { dealCards } from './deal';
import { validatePlay, determineTrickWinner } from './trick';
import { validateBid } from './bidding';
import { calculateTrickPoints, evaluateGameResult } from './score';
import { getMightyCard, getJokerCallCard, isMightyCard, isJokerCard } from './rules';

export type GamePhase = 'LOBBY' | 'BIDDING' | 'PLAYING' | 'ENDED';

export interface EngineOptions {
  players: Player[];
  giruda: string;
}

export class GameEngine {
  state: GameState;
  private deck: Card[] = [];
  private _mightyCard: { suit: string; rank: string };
  private _jokerCallCard: { suit: string; rank: string };
  private _trickNumber = 0;
  private teamPoints = 0;
  private bidScore = 0;
  private ownerId: string;
  private friendId?: string;

  get mightyCard() {
    return this._mightyCard;
  }

  get jokerCallCard() {
    return this._jokerCallCard;
  }

  get trickNumber() {
    return this._trickNumber;
  }

  constructor({ players, giruda }: EngineOptions) {
    if (players.length !== 5) {
      throw new Error('Game requires exactly 5 players');
    }

    const owner = players.find((p) => p.isOwner);
    if (!owner) {
      throw new Error('Owner player is required');
    }

    this.ownerId = owner.id;
    this._mightyCard = getMightyCard(giruda);
    this._jokerCallCard = getJokerCallCard(giruda);

    this.state = {
      roomId: '',
      phase: 'LOBBY',
      turnPlayerId: players[0].id,
      currentTrick: null,
      tricks: [],
      kitty: [],
      giruda: giruda as any,
      ownerPlayerId: this.ownerId,
      friendPlayerId: undefined,
      currentBid: 0,
      players: players.map((p) => ({ ...p, trickScore: 0 })),
    };
  }

  deal(): { hands: Card[][]; kitty: Card[] } {
    const shuffled = shuffleDeck(createDeck());
    if (!validateDeck(shuffled)) {
      throw new Error('Invalid deck');
    }

    const { hands, kitty } = dealCards(shuffled);
    this.deck = shuffled;
    this.state.kitty = kitty;

    this.state.players = this.state.players.map((p, index) => ({
      ...p,
      hand: hands[index] ?? [],
    }));

    return { hands, kitty };
  }

  startBidding(ownerId: string): void {
    if (this.state.phase !== 'LOBBY') {
      throw new Error('Game is not in lobby phase');
    }
    if (ownerId !== this.ownerId) {
      throw new Error('Only the owner can start bidding');
    }

    this.state.phase = 'BIDDING';
    this.state.currentBid = 0;
    this.state.turnPlayerId = this.ownerId;
    this.bidScore = 0;
  }

  placeBid(playerId: string, bid?: number, isPass = false): { valid: boolean; currentBid?: number; bidLeader?: string } {
    if (this.state.phase !== 'BIDDING') {
      throw new Error('Not in bidding phase');
    }

    const validation = validateBid({ bid, currentBid: this.state.currentBid, isPass });
    if (!validation.valid) {
      throw new Error(validation.reason ?? 'invalid_bid');
    }

    const player = this.state.players.find((p) => p.id === playerId);
    if (!player) {
      throw new Error('Player not found');
    }

    if (isPass) {
      player.bid = undefined;
    } else {
      const bidValue = bid ?? 0;
      player.bid = bidValue;
      this.state.currentBid = bidValue;
      this.state.bidLeader = playerId;
      this.bidScore = bidValue;
    }

    this.state.turnPlayerId = this.nextPlayerId(playerId);

    return {
      valid: true,
      currentBid: this.state.currentBid,
      bidLeader: this.state.bidLeader,
    };
  }

  completeBidding(friendId?: string): void {
    if (this.state.phase !== 'BIDDING') {
      throw new Error('Not in bidding phase');
    }

    this.state.phase = 'PLAYING';
    this.state.friendPlayerId = friendId;
    if (friendId) {
      this.state.players = this.state.players.map((p) =>
        p.id === friendId ? { ...p, isFriend: true } : p
      );
    }
    this.state.turnPlayerId = this.state.bidLeader ?? this.ownerId;
    this._trickNumber = 1;
  }

  playCard(playerId: string, cardId: string): { valid: boolean; trickComplete?: boolean; trick?: Trick; points?: number } {
    if (this.state.phase !== 'PLAYING') {
      throw new Error('Not in playing phase');
    }

    const player = this.state.players.find((p) => p.id === playerId);
    if (!player) {
      throw new Error('Player not found');
    }

    if (player.id !== this.state.turnPlayerId) {
      throw new Error('Not this player turn');
    }

    const card = player.hand.find((c) => c.id === cardId);
    if (!card) {
      throw new Error('Card not in hand');
    }

    const leadSuit = this.state.currentTrick
      ? this.state.currentTrick.leadSuit
      : undefined;

    const validation = validatePlay({
      card,
      hand: player.hand,
      leadSuit,
      turnNumber: this._trickNumber,
      totalTricks: 10,
      giruda: this.state.giruda as string,
      jokerCallCard: this._jokerCallCard,
    });

    if (!validation.valid) {
      throw new Error(validation.reason ?? 'invalid_play');
    }

    player.hand = player.hand.filter((c) => c.id !== cardId);

    if (!this.state.currentTrick) {
      this.state.currentTrick = {
        id: `trick_${this._trickNumber}`,
        cards: [],
        leadSuit: card.suit as any,
        winnerPlayerId: undefined,
      };
    }

    this.state.currentTrick.cards.push({ playerId, card });

    if (this.state.currentTrick.cards.length === this.state.players.length) {
      const result = determineTrickWinner({
        plays: this.state.currentTrick.cards,
        leadSuit: this.state.currentTrick.leadSuit,
        giruda: this.state.giruda as string,
        mightyCard: this._mightyCard,
      });

      this.state.currentTrick.winnerPlayerId = result.winnerPlayerId;
      this.state.tricks.push(this.state.currentTrick);

      const winner = this.state.players.find((p) => p.id === result.winnerPlayerId);
      if (winner) {
        winner.trickScore += result.points;
      }

      const isOwnerTeam =
        result.winnerPlayerId === this.ownerId ||
        result.winnerPlayerId === this.state.friendPlayerId;

      if (isOwnerTeam) {
        this.teamPoints += result.points;
      }

      this._trickNumber++;
      this.state.currentTrick = null;

      if (this._trickNumber > 10) {
        this.state.phase = 'ENDED';
      } else {
        this.state.turnPlayerId = result.winnerPlayerId;
      }

      return {
        valid: true,
        trickComplete: true,
        trick: this.state.tricks[this.state.tricks.length - 1],
        points: result.points,
      };
    }

    this.state.turnPlayerId = this.nextPlayerId(playerId);

    return { valid: true, trickComplete: false };
  }

  getResult(): { isWin: boolean; teamPoints: number; bidScore: number } {
    if (this.state.phase !== 'ENDED') {
      throw new Error('Game has not ended');
    }

    const isWin = evaluateGameResult(this.teamPoints, this.bidScore);
    return { isWin, teamPoints: this.teamPoints, bidScore: this.bidScore };
  }

  private nextPlayerId(currentId: string): string {
    const ids = this.state.players.map((p) => p.id);
    const index = ids.indexOf(currentId);
    return ids[(index + 1) % ids.length];
  }
}

export function createInitialGameState(
  roomId: string,
  players: Player[],
  giruda: string
): GameState {
  const engine = new GameEngine({ players, giruda });
  engine.state.roomId = roomId;
  return engine.state;
}

