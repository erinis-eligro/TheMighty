import { Card, Player, GameState, GamePhase, Trick, FriendDeclaration, BidGiruda, RoundResult, Suit } from '../entities/game.entity';
import { SeatPosition } from '../constants';
import { createDeck, shuffleDeck, validateDeck } from './deck';
import { dealCards } from './deal';
import { validatePlay, determineTrickWinner, type TrickResult } from './trick';
import { isAlly } from './team';
import { validateBid, bidRank, BID_GIRUDAS } from './bidding';
import { scoreRound } from './score';
import {
  getMightyCard,
  getJokerCallCard,
  isJokerCallCard,
  isJokerCard,
  isJokerPowerless,
  isPointCard,
  TOTAL_TRICKS,
  MAX_BID,
  KITTY_SIZE,
  GIRUDA_CHANGE_RAISE,
} from './rules';
import { assertTransition } from './phase';
import {
  FriendReveal,
  validateFriendDeclaration,
  resolveFriendTargetCard,
  isFriendTargetCard,
  findFriendHolder,
} from './friend';

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
  private _resolvedWinnerIndex = 0;
  /**
   * Seat index of the player the friend condition points at. Server-side only:
   * it is never sent to clients; `state.friendIndex` is set once it is revealed.
   * Stays null for NO_FRIEND, for a condition the president satisfies himself,
   * and for FIRST_TRICK until the first trick is resolved.
   */
  private friendHolderIndex: number | null = null;

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
      friendRevealed: false,
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
    this.state.friendDeclaration = null;
    this.state.friendIndex = null;
    this.state.friendPlayerId = undefined;
    this.state.friendRevealed = false;
    this.friendHolderIndex = null;
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

  /** Whether the player is the (still hidden or revealed) friend of the president. Server-side knowledge only. */
  isFriend(playerId: string): boolean {
    const idx = this.indexOfPlayer(playerId);
    return idx >= 0 && idx === this.friendHolderIndex;
  }

  /**
   * Whether `otherId` is known to be on the same team as `viewerId` (see `isAlly`).
   * Respects the hidden friend: nothing is inferred from information the viewer
   * would not have.
   */
  isAllyOf(viewerId: string, otherId: string): boolean {
    return isAlly({
      viewerId,
      otherId,
      ownerPlayerId: this.state.ownerPlayerId,
      friendPlayerId: this.state.friendPlayerId,
      friendRevealed: this.state.friendRevealed,
      viewerIsFriend: this.isFriend(viewerId),
    });
  }

  /**
   * Who is winning the trick in progress, judged on the cards played so far
   * (same rules as the final resolution). Null while no card has been played.
   */
  getCurrentTrickWinner(): TrickResult | null {
    const trick = this.state.currentTrick;
    if (!trick || trick.cards.length === 0) return null;
    return determineTrickWinner({
      plays: trick.cards,
      leadSuit: trick.leadSuit,
      giruda: this.state.giruda as string,
      mightyCard: this._mightyCard,
      jokerPowerless: isJokerPowerless({
        trickNumber: trick.trickNumber,
        totalTricks: TOTAL_TRICKS,
        isJokerCallActive: this.state.isJokerCallActive,
      }),
    });
  }

  /**
   * FRIEND_SELECTION -> TRICK_PLAYING. The president declares a friend
   * condition (mighty / joker / a specific card / first trick / no friend) and
   * leads the first trick.
   *
   * The server works out who the friend is; `friendIndex` stays null until the
   * friend is revealed (when the card is played, or when the first trick is
   * won). The friend is revealed immediately, with no friend on the president's
   * team, when the condition is NO_FRIEND, when the president holds the
   * declared card himself, or when nobody holds it (it was discarded).
   *
   * Validation happens before any state is touched.
   */
  declareFriend(
    playerId: string,
    declaration: { type?: string; suit?: string; rank?: string }
  ): { declaration: FriendDeclaration; friendRevealed?: FriendReveal } {
    if (this.state.phase !== 'FRIEND_SELECTION') {
      throw new Error('Not in friend selection phase');
    }
    const playerIndex = this.indexOfPlayer(playerId);
    if (playerIndex < 0) {
      throw new Error('Player not found');
    }
    if (playerIndex !== this.state.presidentIndex) {
      throw new Error('Only the president can declare the friend');
    }
    const validation = validateFriendDeclaration(declaration);
    if (!validation.valid) {
      throw new Error(validation.reason ?? 'invalid_friend_declaration');
    }

    const normalized = (
      declaration.type === 'CARD'
        ? { type: 'CARD', suit: declaration.suit, rank: declaration.rank }
        : { type: declaration.type }
    ) as FriendDeclaration;

    let holder: number | null = null;
    let immediate: FriendReveal['reason'] | null = null;
    if (normalized.type === 'NO_FRIEND') {
      immediate = 'NO_FRIEND';
    } else if (normalized.type !== 'FIRST_TRICK') {
      const target = resolveFriendTargetCard(normalized, this.state.giruda as string)!;
      const found = findFriendHolder(
        this.state.players.map((p) => p.hand),
        target
      );
      if (found < 0) {
        immediate = 'CARD_NOT_IN_PLAY';
      } else if (found === playerIndex) {
        immediate = 'PRESIDENT_HOLDS_CARD';
      } else {
        holder = found;
      }
    }

    this.transition('TRICK_PLAYING');
    this.state.friendDeclaration = normalized;
    this.state.friendIndex = null;
    this.state.friendPlayerId = undefined;
    this.state.friendRevealed = false;
    this.friendHolderIndex = holder;
    this.state.currentTrickNumber = 1;
    this._trickNumber = 1;
    this.setTurn(this.state.presidentIndex ?? FIRST_BIDDER_INDEX);

    return {
      declaration: normalized,
      friendRevealed: immediate ? this.revealFriend(null, immediate) : undefined,
    };
  }

  /** Publishes the friend (or the fact that the president plays without one). */
  private revealFriend(friendIndex: number | null, reason: FriendReveal['reason']): FriendReveal {
    this.state.friendRevealed = true;
    if (friendIndex !== null) {
      this.state.friendIndex = friendIndex;
      this.state.friendPlayerId = this.state.players[friendIndex].id;
      this.state.players = this.state.players.map((p, i) => (i === friendIndex ? { ...p, isFriend: true } : p));
    }
    return { friendPlayerId: this.state.friendPlayerId ?? null, friendIndex, reason };
  }

  /**
   * Plays a card for the current player.
   *
   * @param options.jokerCall The leader declares the joker call (requires leading with the
   *   joker-call card). While active, the joker has no power and the joker-call card must be played.
   * @param options.jokerLeadSuit Suit the leader names when leading with the joker.
   */
  playCard(
    playerId: string,
    cardId: string,
    options: { jokerCall?: boolean; jokerLeadSuit?: string } = {}
  ): { valid: boolean; trickComplete?: boolean; trick?: Trick; points?: number; friendRevealed?: FriendReveal } {
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

    const isLeading = !this.state.currentTrick;
    const leadSuit = this.state.currentTrick ? this.state.currentTrick.leadSuit : undefined;

    const validation = validatePlay({
      card,
      hand: player.hand,
      leadSuit,
      isLeading,
      trickNumber: this._trickNumber,
      totalTricks: TOTAL_TRICKS,
      giruda: this.state.giruda as string,
      restrictGirudaLead: this.restrictsGirudaLead(),
      isJokerCallActive: this.state.isJokerCallActive,
      declaresJokerCall: options.jokerCall === true,
      jokerLeadSuit: options.jokerLeadSuit,
    });

    if (!validation.valid) {
      throw new Error(validation.reason ?? 'invalid_play');
    }

    player.hand = player.hand.filter((c) => c.id !== cardId);

    let trick = this.state.currentTrick;
    if (!trick) {
      // A joker has no suit of its own: the leader names the suit to follow.
      const ledSuit = (isJokerCard(card) ? options.jokerLeadSuit : card.suit) as Suit | undefined;
      trick = {
        id: `trick_${this._trickNumber}`,
        trickNumber: this._trickNumber,
        cards: [],
        leadSuit: ledSuit,
        winnerPlayerId: undefined,
      };
      this.state.currentTrick = trick;
      this.state.leadSuit = ledSuit ?? null;
      this.state.isJokerCallActive = options.jokerCall === true;
    }

    trick.cards.push({ playerId, playerIndex, card });

    // The friend is revealed the moment the declared card is played.
    let friendRevealed: FriendReveal | undefined;
    const declaration = this.state.friendDeclaration;
    if (!this.state.friendRevealed && playerIndex === this.friendHolderIndex && declaration) {
      const target = resolveFriendTargetCard(declaration, this.state.giruda as string);
      if (target && isFriendTargetCard(card, target)) {
        friendRevealed = this.revealFriend(playerIndex, 'CARD_PLAYED');
      }
    }

    if (trick.cards.length === this.state.players.length) {
      const resolved = this.resolveTrick();
      return { ...resolved, friendRevealed: friendRevealed ?? resolved.friendRevealed };
    }

    this.setTurn(playerIndex + 1);

    return { valid: true, trickComplete: false, friendRevealed };
  }

  /**
   * True when the current turn player is the president leading the first trick
   * with a giruda declared: the president may not lead the giruda then.
   */
  restrictsGirudaLead(): boolean {
    const s = this.state;
    return (
      s.phase === 'TRICK_PLAYING' &&
      this._trickNumber === 1 &&
      s.currentTrick === null &&
      s.currentTurnIndex === s.presidentIndex &&
      s.giruda !== 'NO_GIRUDA'
    );
  }

  /**
   * TRICK_PLAYING -> TRICK_RESOLVED. Decides the winner, collects the score
   * cards and records the trick. The completed trick stays in
   * `state.currentTrick` so clients can see all 5 cards; the game moves on
   * with `advanceAfterTrick()` once the resolve delay has passed.
   */
  private resolveTrick(): {
    valid: boolean;
    trickComplete: true;
    trick: Trick;
    points: number;
    friendRevealed?: FriendReveal;
  } {
    const trick = this.state.currentTrick!;
    this.transition('TRICK_RESOLVED');

    const result = determineTrickWinner({
      plays: trick.cards,
      leadSuit: trick.leadSuit,
      giruda: this.state.giruda as string,
      mightyCard: this._mightyCard,
      jokerPowerless: isJokerPowerless({
        trickNumber: trick.trickNumber,
        totalTricks: TOTAL_TRICKS,
        isJokerCallActive: this.state.isJokerCallActive,
      }),
    });

    const winnerIndex = this.indexOfPlayer(result.winnerPlayerId);
    trick.winnerPlayerId = result.winnerPlayerId;
    trick.winnerIndex = winnerIndex;
    this.state.trickHistory.push(trick);
    this._resolvedWinnerIndex = winnerIndex;

    const winner = this.state.players[winnerIndex];
    if (winner) {
      const won = trick.cards.map((c) => c.card).filter((c) => isPointCard(c));
      winner.collectedScoreCards = [...winner.collectedScoreCards, ...won];
      winner.score = winner.collectedScoreCards.length;
    }

    // First-trick friend: whoever wins trick 1 (other than the president) is the friend.
    let friendRevealed: FriendReveal | undefined;
    if (this.state.friendDeclaration?.type === 'FIRST_TRICK' && !this.state.friendRevealed) {
      if (winnerIndex === this.state.presidentIndex) {
        friendRevealed = this.revealFriend(null, 'PRESIDENT_WON_FIRST_TRICK');
      } else {
        this.friendHolderIndex = winnerIndex;
        friendRevealed = this.revealFriend(winnerIndex, 'FIRST_TRICK_WON');
      }
    }

    return {
      valid: true,
      trickComplete: true,
      trick,
      points: result.points,
      friendRevealed,
    };
  }

  /**
   * TRICK_RESOLVED -> TRICK_PLAYING (the trick winner leads the next trick), or
   * TRICK_RESOLVED -> ROUND_SCORING -> GAME_OVER after the last trick.
   * Called by the server timer after the resolve delay.
   */
  advanceAfterTrick(): { gameOver: boolean } {
    if (this.state.phase !== 'TRICK_RESOLVED') {
      throw new Error('Not in trick resolved phase');
    }

    this.state.currentTrick = null;
    this.state.leadSuit = null;
    this.state.isJokerCallActive = false;
    this._trickNumber++;

    if (this._trickNumber > TOTAL_TRICKS) {
      this.transition('ROUND_SCORING');
      this.scoreRound();
      this.transition('GAME_OVER');
      return { gameOver: true };
    }

    this.state.currentTrickNumber = this._trickNumber;
    this.transition('TRICK_PLAYING');
    this.setTurn(this._resolvedWinnerIndex);
    return { gameOver: false };
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

