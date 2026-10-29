import { IsString, IsUUID, IsNumber, IsBoolean, IsOptional, IsArray, ValidateNested, IsIn, IsEnum, MinLength, MaxLength } from 'class-validator';
import { Transform, Type } from 'class-transformer';
import { Role, Giruda } from '@prisma/client';

export class CreateRoomDto {
  /** Display/stats nickname; trimmed. Identity of the session is the rejoin token, not the nickname. */
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @MinLength(1)
  @MaxLength(50)
  username!: string;
}

export class JoinRoomDto {
  @IsString()
  @IsUUID()
  roomId!: string;

  /** Secret returned by create_room; proves the caller owns the session. */
  @IsString()
  @MinLength(1)
  rejoinToken!: string;
}

export class PlaceBidDto {
  @IsString()
  @IsUUID()
  roomId!: string;

  /** Ignored for identity: the server uses the player bound to the socket. If sent, it must match. */
  @IsString()
  @IsUUID()
  @IsOptional()
  playerId?: string;

  @IsNumber()
  @IsOptional()
  bid?: number;

  /** SPADE | DIAMOND | HEART | CLUB | NO_GIRUDA. Required unless passing. */
  @IsString()
  @IsOptional()
  giruda?: string;

  @IsBoolean()
  @IsOptional()
  pass?: boolean;
}

export class ExchangeKittyDto {
  @IsString()
  @IsUUID()
  roomId!: string;

  /** Ignored for identity: the server uses the player bound to the socket. If sent, it must match. */
  @IsString()
  @IsUUID()
  @IsOptional()
  playerId?: string;

  /** Exactly 3 distinct card ids from the president's 13 cards (hand + kitty). */
  @IsArray()
  @IsString({ each: true })
  discardCardIds!: string[];

  /** Final giruda. Omit to keep the bid giruda. */
  @IsString()
  @IsOptional()
  giruda?: string;

  /** Raised bid score; required only when the giruda is changed. */
  @IsNumber()
  @IsOptional()
  bidScore?: number;
}

export class DeclareFriendDto {
  @IsString()
  @IsUUID()
  roomId!: string;

  /** Ignored for identity: the server uses the player bound to the socket. If sent, it must match. */
  @IsString()
  @IsUUID()
  @IsOptional()
  playerId?: string;

  /** NO_FRIEND | FIRST_TRICK | MIGHTY | JOKER | CARD */
  @IsString()
  @IsIn(['NO_FRIEND', 'FIRST_TRICK', 'MIGHTY', 'JOKER', 'CARD'])
  type!: string;

  /** Required when type is CARD. */
  @IsString()
  @IsOptional()
  suit?: string;

  /** Required when type is CARD. */
  @IsString()
  @IsOptional()
  rank?: string;
}

export class PlayCardDto {
  @IsString()
  @IsUUID()
  roomId!: string;

  /** Ignored for identity: the server uses the player bound to the socket. If sent, it must match. */
  @IsString()
  @IsUUID()
  @IsOptional()
  playerId?: string;

  @IsString()
  cardId!: string;

  /** Leader declares the joker call; only valid when leading with the joker-call card. */
  @IsBoolean()
  @IsOptional()
  jokerCall?: boolean;

  /** Suit named when leading with the joker. */
  @IsIn(['SPADE', 'DIAMOND', 'HEART', 'CLUB'])
  @IsOptional()
  jokerLeadSuit?: string;
}

export class GameStateDto {
  @IsString()
  roomId!: string;

  @IsString()
  phase!: string;

  @IsString()
  turnplayerId!: string;

  @IsNumber()
  currentTurnIndex!: number;

  @IsNumber()
  currentTrickNumber!: number;

  @IsNumber()
  passCount!: number;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => Object)
  players!: any[];

  @IsOptional()
  @ValidateNested()
  @Type(() => Object)
  currentTrick?: any;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => Object)
  trickHistory!: any[];

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => Object)
  kitty!: any[];

  @IsEnum(Giruda, { each: false, message: 'giruda must be a valid giruda value' })
  giruda!: Giruda;

  @IsString()
  ownerplayerId!: string;

  @IsString()
  @IsOptional()
  friendPlayerId?: string;

  @IsNumber()
  currentBid!: number;

  @IsString()
  @IsOptional()
  bidLeader?: string;
}

export class ErrorDto {
  @IsString()
  code!: string;

  @IsString()
  message!: string;
}

