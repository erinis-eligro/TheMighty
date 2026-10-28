import { Card, Player, GameState, GamePhase, Trick, FriendDeclaration, BidGiruda, RoundResult } from '../entities/game.entity';
import { SeatPosition } from '../constants';
import { createDeck, shuffleDeck, validateDeck } from './deck';
import { dealCards } from './deal';
import { validatePlay, determineTrickWinner } from './trick';
import { validateBid, bidRank, BID_GIRUDAS } from './bidding';
import { scoreRound } from './score';
import {
  getMightyCard,
  getJokerCallCard,
  isJokerCallCard,
  isPointCard,
  TOTAL_TRICKS,
  MAX_BID,
  KITTY_SIZE,
  GIRUDA_CHANGE_RAISE,
} from './rules';
import { assertTransition } from './phase';

export type { GamePhase };

export interface EngineOptions {
  players: Player[];
  giruda: string;
}

const FIRST_BIDDER_INDEX = 0;

export class GameEngine {
  state: GameState;
  private deck: Card[] = [];
  private _mightyCard: { suit: string; rank: string };
  private _jokerCallCard: { suit: string; rank: string };
  private _trickNumber = 0;
  private bidScore = 0;

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

    this._mightyCard = getMightyCard(giruda);
    this._jokerCallCard = getJokerCallCard(giruda);

    this.state = {
      roomId: '',
      phase: 'READY',
      currentTurnIndex: 0,
      turnPlayerId: players[0].id,
      currentTrick: null,
      trickHistory: [],
      currentTrickNumber: 0,
      leadSuit: null,
      isJokerCallActive: false,
      kitty: [],
      giruda: giruda as any,
      // The president (owner) is decided by bidding, not by who created the room.
      ownerPlayerId: '',
      presidentIndex: null,
      friendDeclaration: null,
      friendIndex: null,
      friendPlayerId: undefined,
      passCount: 0,
      currentBid: 0,
      highestBid: null,
      players: players.map((p) => ({
        ...p,
        isOwner: false,
        hasPassed: false,
        bid: undefined,
        collectedScoreCards: [],
        score: 0,
      })),
    };
  }

  /**
   * The only way to change `state.phase`. Throws if the transition is not
   * allowed by the state machine (see ALLOWED_TRANSITIONS in ./phase).
   */
  transition(to: GamePhase): void {
    assertTransition(this.state.phase, to);
    this.state.phase = to;
  }

  /** Sets whose turn it is. `currentTurnIndex` is the source of truth. */
  private setTurn(index: number): void {
    const n = this.state.players.length;
    this.state.currentTurnIndex = ((index % n) + n) % n;
    this.state.turnPlayerId = this.state.players[this.state.currentTurnIndex].id;
  }

  private indexOfPlayer(playerId: string): number {
    return this.state.players.findIndex((p) => p.id === playerId);
  }

  /** READY -> DEALING -> BIDDING. Deals the cards and opens bidding with the first seat. */
  deal(): { hands: Card[][]; kitty: Card[] } {
    this.transition('DEALING');
    return this.dealAndOpenBidding();
  }

  /** DEALING -> BIDDING. Shared by the first deal and by a re-deal after everybody passed. */
  private dealAndOpenBidding(): { hands: Card[][]; kitty: Card[] } {
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
      bid: undefined,
      hasPassed: false,
      isOwner: false,
    }));

    this.transition('BIDDING');
    this.state.currentBid = 0;
    this.state.highestBid = null;
    this.state.bidLeader = undefined;
    this.state.passCount = 0;
    this.state.presidentIndex = null;
    this.state.ownerPlayerId = '';
    this.bidScore = 0;
    this.setTurn(FIRST_BIDDER_INDEX);

    return { hands, kitty };
  }

  /**
   * Places a bid (score 13~20 + giruda, incl. no-giruda) or passes for the
   * current player. Passed players are skipped for the rest of the bidding.
   *
   * Bidding ends when only the highest bidder is left (or nobody can outbid
   * the highest bid): the winner becomes president and the phase moves to
   * KITTY_EXCHANGE. If all five players pass, the cards are dealt again.
   */
  placeBid(
    playerId: string,
    action: { pass?: boolean; score?: number; giruda?: string }
  ): {
    valid: boolean;
    currentBid: number;
    bidLeader?: string;
    /** Bidding finished and a president was chosen. */
    completed: boolean;
    /** Everybody passed and new hands were dealt. */
    redealt: boolean;
  } {
    if (this.state.phase !== 'BIDDING') {
      throw new Error('Not in bidding phase');
    }

    const playerIndex = this.indexOfPlayer(playerId);
    if (playerIndex < 0) {
      throw new Error('Player not found');
    }
    if (playerIndex !== this.state.currentTurnIndex) {
      throw new Error('Not this player turn');
    }

    const isPass = action.pass === true;
    const validation = validateBid({
      score: action.score,
      giruda: action.giruda,
      currentBid: this.state.highestBid,
      isPass,
    });
    if (!validation.valid) {
      throw new Error(validation.reason ?? 'invalid_bid');
    }

    const player = this.state.players[playerIndex];

    if (isPass) {
      player.bid = undefined;
      player.hasPassed = true;
      this.state.passCount += 1;
    } else {
      const score = action.score as number;
      const giruda = action.giruda as BidGiruda;
      player.bid = score;
      this.state.highestBid = { bidderIndex: playerIndex, score, giruda };
      this.state.currentBid = score;
      this.state.bidLeader = playerId;
    }

    const active = this.state.players.filter((p) => !p.hasPassed);
    const highest = this.state.highestBid;

    let completed = false;
    let redealt = false;

    if (!highest && active.length === 0) {
      // Everybody passed: re-deal.
      this.transition('DEALING');
      this.dealAndOpenBidding();
      redealt = true;
    } else if (
      highest &&
      (active.length === 1 || bidRank(highest.score, highest.giruda) >= bidRank(MAX_BID, 'NO_GIRUDA'))
    ) {
      this.completeBidding();
      completed = true;
    } else {
      this.advanceBidTurn(playerIndex);
    }

    return {
      valid: true,
      currentBid: this.state.currentBid,
      bidLeader: this.state.bidLeader,
      completed,
      redealt,
    };
  }

  /** Moves the turn to the next player who has not passed. */
  private advanceBidTurn(fromIndex: number): void {
    const n = this.state.players.length;
    for (let step = 1; step <= n; step++) {
      const idx = (fromIndex + step) % n;
      if (!this.state.players[idx].hasPassed) {
        this.setTurn(idx);
        return;
      }
    }
  }

  /** Recomputes everything derived from the giruda (mighty and joker-call cards). */
  private applyGiruda(giruda: BidGiruda): void {
    this.state.giruda = giruda;
    this._mightyCard = getMightyCard(giruda);
    this._jokerCallCard = getJokerCallCard(giruda);
  }

  /** BIDDING -> KITTY_EXCHANGE. Fixes the president, giruda and bid score. */
  private completeBidding(): void {
    const highest = this.state.highestBid;
    if (!highest) {
      throw new Error('No bid has been placed');
    }
    this.transition('KITTY_EXCHANGE');

    const president = this.state.players[highest.bidderIndex];
    this.state.presidentIndex = highest.bidderIndex;
    this.state.ownerPlayerId = president.id;
    this.state.players = this.state.players.map((p, i) => ({ ...p, isOwner: i === highest.bidderIndex }));
    this.bidScore = highest.score;
    this.applyGiruda(highest.giruda);
    this.setTurn(highest.bidderIndex);
  }

  /**
   * KITTY_EXCHANGE -> FRIEND_SELECTION. The president picks up the 3 kitty
   * cards (13 in hand), discards exactly 3 of them and finalizes the giruda.
   *
   * Rules:
   * - Only the president may exchange, and every discard must be a distinct
   *   card of the 13-card hand (kitty cards included).
   * - Keeping the bid giruda is free. Changing it requires raising the bid
   *   score by at least `GIRUDA_CHANGE_RAISE` (capped at MAX_BID), passed as `bidScore`.
   * - Discarded point cards are not counted for either team; the discards are
   *   stored in `state.kitty` (visible to the president only).
   *
   * Validation happens before any state is touched, so a rejected exchange
   * leaves the game unchanged.
   */
  exchangeKitty(
    playerId: string,
    action: { discardCardIds: string[]; giruda?: string; bidScore?: number }
  ): { giruda: BidGiruda; bidScore: number; discarded: Card[] } {
    if (this.state.phase !== 'KITTY_EXCHANGE') {
      throw new Error('Not in kitty exchange phase');
    }

    const playerIndex = this.indexOfPlayer(playerId);
    if (playerIndex < 0) {
      throw new Error('Player not found');
    }
    if (playerIndex !== this.state.presidentIndex) {
      throw new Error('Only the president can exchange the kitty');
    }

    const ids = action.discardCardIds;
    if (!Array.isArray(ids) || ids.length !== KITTY_SIZE) {
      throw new Error('must_discard_exactly_3');
    }
    if (new Set(ids).size !== ids.length) {
      throw new Error('duplicate_discard');
    }

    const president = this.state.players[playerIndex];
    const combined = [...president.hand, ...this.state.kitty];
    if (!ids.every((id) => combined.some((c) => c.id === id))) {
      throw new Error('discard_not_in_hand');
    }

    const bid = this.state.highestBid;
    if (!bid) {
      throw new Error('No bid has been placed');
    }
    const requestedGiruda = (action.giruda ?? bid.giruda) as BidGiruda;
    if (!BID_GIRUDAS.includes(requestedGiruda)) {
      throw new Error('invalid_giruda');
    }

    let finalScore = bid.score;
    if (requestedGiruda !== bid.giruda) {
      const raised = action.bidScore;
      if (raised === undefined || !Number.isInteger(raised)) {
        throw new Error('bid_raise_required');
      }
      if (raised < bid.score + GIRUDA_CHANGE_RAISE) {
        throw new Error('bid_raise_too_small');
      }
      if (raised > MAX_BID) {
        throw new Error('bid_above_maximum');
      }
      finalScore = raised;
    } else if (action.bidScore !== undefined && action.bidScore !== bid.score) {
      // Without a giruda change the bid score is fixed.
      throw new Error('bid_raise_requires_giruda_change');
    }

    this.transition('FRIEND_SELECTION');

    const discarded = combined.filter((c) => ids.includes(c.id));
    president.hand = combined.filter((c) => !ids.includes(c.id));
    this.state.kitty = discarded;

    this.state.highestBid = { ...bid, score: finalScore, giruda: requestedGiruda };
    this.state.currentBid = finalScore;
    this.bidScore = finalScore;
    this.applyGiruda(requestedGiruda);

    return { giruda: requestedGiruda, bidScore: finalScore, discarded };
  }

  /** FRIEND_SELECTION -> TRICK_PLAYING. The president leads the first trick. */
  selectFriend(declaration: FriendDeclaration, friendId?: string): void {
    if (this.state.phase !== 'FRIEND_SELECTION') {
      throw new Error('Not in friend selection phase');
    }

    const friendIndex = friendId ? this.indexOfPlayer(friendId) : -1;
    if (friendId && friendIndex < 0) {
      throw new Error('Friend player not found');
    }

    this.transition('TRICK_PLAYING');
    this.state.friendDeclaration = declaration;
    this.state.friendIndex = friendIndex >= 0 ? friendIndex : null;
    this.state.friendPlayerId = friendId;
    if (friendId) {
      this.state.players = this.state.players.map((p) =>
        p.id === friendId ? { ...p, isFriend: true } : p
      );
    }
    this.state.currentTrickNumber = 1;
    this._trickNumber = 1;
    this.setTurn(this.state.presidentIndex ?? FIRST_BIDDER_INDEX);
  }

  playCard(playerId: string, cardId: string): { valid: boolean; trickComplete?: boolean; trick?: Trick; points?: number } {
    if (this.state.phase !== 'TRICK_PLAYING') {
      throw new Error('Not in playing phase');
    }

    const playerIndex = this.indexOfPlayer(playerId);
    if (playerIndex < 0) {
      throw new Error('Player not found');
    }
    const player = this.state.players[playerIndex];

    if (playerIndex !== this.state.currentTurnIndex) {
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
      totalTricks: TOTAL_TRICKS,
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
        trickNumber: this._trickNumber,
        cards: [],
        leadSuit: card.suit as any,
        winnerPlayerId: undefined,
      };
      this.state.leadSuit = card.suit as any;
      this.state.isJokerCallActive = isJokerCallCard(card, this.state.giruda as string);
    }

    this.state.currentTrick.cards.push({ playerId, playerIndex, card });

    if (this.state.currentTrick.cards.length === this.state.players.length) {
      return this.resolveTrick();
    }

    this.setTurn(playerIndex + 1);

    return { valid: true, trickComplete: false };
  }

  /** TRICK_PLAYING -> TRICK_RESOLVED -> (TRICK_PLAYING | ROUND_SCORING -> GAME_OVER). */
  private resolveTrick(): { valid: boolean; trickComplete: true; trick: Trick; points: number } {
    const trick = this.state.currentTrick!;
    this.transition('TRICK_RESOLVED');

    const result = determineTrickWinner({
      plays: trick.cards,
      leadSuit: trick.leadSuit,
      giruda: this.state.giruda as string,
      mightyCard: this._mightyCard,
    });

    const winnerIndex = this.indexOfPlayer(result.winnerPlayerId);
    trick.winnerPlayerId = result.winnerPlayerId;
    trick.winnerIndex = winnerIndex;
    this.state.trickHistory.push(trick);

    const winner = this.state.players[winnerIndex];
    if (winner) {
      const won = trick.cards.map((c) => c.card).filter((c) => isPointCard(c));
      winner.collectedScoreCards = [...winner.collectedScoreCards, ...won];
      winner.score = winner.collectedScoreCards.length;
    }

    this.state.currentTrick = null;
    this.state.leadSuit = null;
    this.state.isJokerCallActive = false;
    this._trickNumber++;

    if (this._trickNumber > TOTAL_TRICKS) {
      this.transition('ROUND_SCORING');
      this.scoreRound();
      this.transition('GAME_OVER');
    } else {
      this.state.currentTrickNumber = this._trickNumber;
      this.transition('TRICK_PLAYING');
      this.setTurn(winnerIndex);
    }

    return {
      valid: true,
      trickComplete: true,
      trick,
      points: result.points,
    };
  }

  /** ROUND_SCORING: totals the owner team / opposition score cards and decides the winner. */
  private scoreRound(): void {
    if (this.state.phase !== 'ROUND_SCORING') {
      throw new Error('Not in round scoring phase');
    }
    this.state.result = scoreRound({
      players: this.state.players,
      ownerPlayerId: this.state.ownerPlayerId,
      friendPlayerId: this.state.friendPlayerId,
      bidScore: this.bidScore,
      giruda: this.state.giruda,
    });
  }

  getResult(): RoundResult {
    if (this.state.phase !== 'GAME_OVER' || !this.state.result) {
      throw new Error('Game has not ended');
    }
    return this.state.result;
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

