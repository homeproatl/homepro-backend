import { Transform } from 'class-transformer';
import {
  IsEnum,
  IsInt,
  IsMongoId,
  IsOptional,
  IsString,
  MaxLength,
  Min,
} from 'class-validator';
import { ASSET_KINDS, ASSET_OWNER_TYPES } from '../schemas/asset.schema';
import type { AssetKind, AssetOwnerType } from '../schemas/asset.schema';

function trimString(value: unknown) {
  return typeof value === 'string' ? value.trim() : value;
}

export class CreateAssetDirectSessionDto {
  @IsEnum(ASSET_OWNER_TYPES)
  owner_type!: AssetOwnerType;

  @IsMongoId()
  owner_id!: string;

  @IsEnum(ASSET_KINDS)
  kind!: AssetKind;

  @Transform(({ value }) => trimString(value))
  @IsString()
  @MaxLength(240)
  filename!: string;

  @Transform(({ value }) => trimString(value))
  @IsString()
  @MaxLength(120)
  mime_type!: string;

  @Transform(({ value }) =>
    typeof value === 'string' && /^\d+$/.test(value.trim())
      ? Number(value.trim())
      : value,
  )
  @IsInt()
  @Min(1)
  size!: number;

  @IsOptional()
  @Transform(({ value }) => trimString(value))
  @IsString()
  @MaxLength(128)
  checksum_sha256?: string;
}
