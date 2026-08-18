import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';
import { CONTRACT_TEMPLATE_FIELD_LIMITS } from '../schemas/contract-template.schema';

function trimRequiredString(value: unknown) {
  return typeof value === 'string' ? value.trim() : value;
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

export class CreateContractTemplateDto {
  @Transform(({ value }) => trimRequiredString(value))
  @IsString()
  @MinLength(1)
  @MaxLength(CONTRACT_TEMPLATE_FIELD_LIMITS.name)
  name!: string;

  @Transform(({ value }) => trimRequiredString(value))
  @IsString()
  @MinLength(1)
  @MaxLength(CONTRACT_TEMPLATE_FIELD_LIMITS.body)
  body!: string;

  @IsOptional()
  @Transform(({ value }) => transformBoolean(value))
  @IsBoolean()
  is_default?: boolean;
}

export class UpdateContractTemplateDto {
  @IsOptional()
  @Transform(({ value }) => trimRequiredString(value))
  @IsString()
  @MinLength(1)
  @MaxLength(CONTRACT_TEMPLATE_FIELD_LIMITS.name)
  name?: string;

  @IsOptional()
  @Transform(({ value }) => trimRequiredString(value))
  @IsString()
  @MinLength(1)
  @MaxLength(CONTRACT_TEMPLATE_FIELD_LIMITS.body)
  body?: string;

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
