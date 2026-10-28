import { IsString, IsUUID, IsNumber, IsBoolean, IsOptional, IsArray, ValidateNested, IsIn, IsEnum } from 'class-validator';
import { Type } from 'class-transformer';
import { Role, Giruda } from '@prisma/client';

export class CreateRoomDto {
  @IsString()
  username!: string;
}

export class JoinRoomDto {
  @IsString()
  @IsUUID()
  roomId!: string;

  @IsString()
  username!: string;
}

export class PlaceBidDto {
  @IsString()
  @IsUUID()
  roomId!: string;

  @IsString()
  @IsUUID()
  playerId!: string;

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

export class DeclareFriendDto {
  @IsString()
  @IsUUID()
  roomId!: string;

  @IsString()
  @IsUUID()
  playerId!: string;

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

  @IsString()
  @IsUUID()
  playerId!: string;

  @IsString()
  cardId!: string;
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

