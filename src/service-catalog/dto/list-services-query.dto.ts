import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

function normalizeSearchValue(value: unknown) {
  if (typeof value !== 'string') {
    return value;
  }

  const trimmedValue = value.trim();
  return trimmedValue.length > 0 ? trimmedValue : undefined;
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

function transformNumber(value: unknown) {
  if (value === undefined || value === null || value === '') {
    return undefined;
  }

  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : value;
}

export class ListServicesQueryDto {
  @IsOptional()
  @Transform(({ value }) => normalizeSearchValue(value))
  @IsString()
  @MaxLength(120)
  search?: string;

  @IsOptional()
  @Transform(({ value }) => transformBoolean(value))
  @IsBoolean()
  paginated?: boolean;

  @IsOptional()
  @Transform(({ value }) => transformNumber(value))
  @IsInt()
  @Min(1)
  page?: number;

  @IsOptional()
  @Transform(({ value }) => transformNumber(value))
  @IsInt()
  @Min(1)
  @Max(100)
  page_size?: number;
}
