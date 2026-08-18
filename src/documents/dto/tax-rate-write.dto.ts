import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { TAX_RATE_FIELD_LIMITS } from '../schemas/tax-rate.schema';

function trimRequiredString(value: unknown) {
  return typeof value === 'string' ? value.trim() : value;
}

function transformInteger(value: unknown) {
  if (value === undefined || value === null || value === '') {
    return undefined;
  }
  if (typeof value === 'number' && Number.isSafeInteger(value)) {
    return value;
  }
  if (typeof value === 'string' && /^-?\d+$/.test(value.trim())) {
    return Number(value.trim());
  }
  return value;
}

function transformBoolean(value: unknown) {
  if (value === undefined || value === null || value === '') {
    return undefined;
  }
  if (value === true || value === 'true') {
    return true;
  }
  if (value === false || value === 'false') {
    return false;
  }
  return value;
}

export class CreateTaxRateDto {
  @Transform(({ value }) => trimRequiredString(value))
  @IsString()
  @MinLength(1)
  @MaxLength(TAX_RATE_FIELD_LIMITS.name)
  name!: string;

  @Transform(({ value }) => transformInteger(value))
  @IsInt()
  @Min(1)
  @Max(TAX_RATE_FIELD_LIMITS.rate_basis_points_max)
  rate_basis_points!: number;

  @IsOptional()
  @Transform(({ value }) => transformBoolean(value))
  @IsBoolean()
  is_default?: boolean;
}

export class UpdateTaxRateDto {
  @IsOptional()
  @Transform(({ value }) => trimRequiredString(value))
  @IsString()
  @MinLength(1)
  @MaxLength(TAX_RATE_FIELD_LIMITS.name)
  name?: string;

  @IsOptional()
  @Transform(({ value }) => transformInteger(value))
  @IsInt()
  @Min(1)
  @Max(TAX_RATE_FIELD_LIMITS.rate_basis_points_max)
  rate_basis_points?: number;

  @IsOptional()
  @Transform(({ value }) => transformBoolean(value))
  @IsBoolean()
  is_active?: boolean;

  @IsOptional()
  @Transform(({ value }) => transformBoolean(value))
  @IsBoolean()
  is_default?: boolean;

  /** Optimistic concurrency via updated_at ISO timestamp when provided. */
  @IsOptional()
  @IsString()
  expected_updated_at?: string;
}
