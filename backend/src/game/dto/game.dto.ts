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

  @IsBoolean()
  @IsOptional()
  pass?: boolean;
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
  tricks!: any[];

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

