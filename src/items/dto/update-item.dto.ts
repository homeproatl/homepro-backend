import { Transform } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsEnum,
  IsInt,
  IsMongoId,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateIf,
} from 'class-validator';
import {
  ITEM_FIELD_LIMITS,
  ITEM_TYPE_VALUES,
  MARKUP_TYPE_VALUES,
  type ItemType,
  type MarkupType,
} from '../schemas/item.schema';

function trimToNull(value: unknown) {
  if (value === undefined) {
    return undefined;
  }
  if (value === null) {
    return null;
  }
  if (typeof value !== 'string') {
    return value;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
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

/** Parse integers without coercing empty strings to 0. */
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

function transformNullableInteger(value: unknown) {
  if (value === undefined) {
    return undefined;
  }
  if (value === null || value === '') {
    return null;
  }
  return transformInteger(value);
}

function trimRequiredString(value: unknown) {
  return typeof value === 'string' ? value.trim() : value;
}

export class UpdateItemDto {
  @IsOptional()
  @Transform(({ value }) => trimRequiredString(value))
  @IsString()
  @MinLength(1)
  @MaxLength(ITEM_FIELD_LIMITS.name)
  name?: string;

  @IsOptional()
  @IsEnum(ITEM_TYPE_VALUES)
  item_type?: ItemType;

  @IsOptional()
  @Transform(({ value }) => trimToNull(value))
  @ValidateIf((_, value) => value !== null && value !== undefined)
  @IsString()
  @MaxLength(ITEM_FIELD_LIMITS.description_template)
  description_template?: string | null;

  @IsOptional()
  @Transform(({ value }) => transformInteger(value))
  @IsInt()
  @Min(0)
  @Max(ITEM_FIELD_LIMITS.rate_minor_max)
  default_rate_minor?: number;

  @IsOptional()
  @Transform(({ value }) => trimToNull(value))
  @ValidateIf((_, value) => value !== null && value !== undefined)
  @IsString()
  @MaxLength(ITEM_FIELD_LIMITS.unit_of_measure)
  default_unit_of_measure?: string | null;

  @IsOptional()
  @Transform(({ value }) => transformNullableInteger(value))
  @ValidateIf((_, value) => value !== null && value !== undefined)
  @IsInt()
  @Min(0)
  @Max(ITEM_FIELD_LIMITS.rate_minor_max)
  default_internal_unit_cost_minor?: number | null;

  @IsOptional()
  @Transform(({ value }) => trimToNull(value))
  @ValidateIf((_, value) => value !== null && value !== undefined)
  @IsString()
  @MaxLength(ITEM_FIELD_LIMITS.vendor_name)
  default_vendor_name?: string | null;

  @IsOptional()
  @Transform(({ value }) => trimToNull(value))
  @ValidateIf((_, value) => value !== null && value !== undefined)
  @IsString()
  @MaxLength(ITEM_FIELD_LIMITS.sku_or_part_number)
  default_sku_or_part_number?: string | null;

  @IsOptional()
  @Transform(({ value }) => transformInteger(value))
  @IsInt()
  @Min(0)
  @Max(ITEM_FIELD_LIMITS.waste_basis_points_max)
  default_waste_basis_points?: number;

  @IsOptional()
  @IsEnum(MARKUP_TYPE_VALUES)
  default_markup_type?: MarkupType;

  @IsOptional()
  @Transform(({ value }) => transformInteger(value))
  @IsInt()
  @Min(0)
  @Max(ITEM_FIELD_LIMITS.markup_value_max)
  default_markup_value?: number;

  @IsOptional()
  @Transform(({ value }) => transformBoolean(value))
  @IsBoolean()
  taxable_default?: boolean;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(8)
  @IsMongoId({ each: true })
  tax_ids?: string[];

  @IsOptional()
  @Transform(({ value }) => trimToNull(value))
  @ValidateIf((_, value) => value !== null && value !== undefined)
  @IsString()
  @MaxLength(ITEM_FIELD_LIMITS.category)
  category?: string | null;

  @IsOptional()
  @Transform(({ value }) => trimToNull(value))
  @ValidateIf((_, value) => value !== null && value !== undefined)
  @IsString()
  @MaxLength(ITEM_FIELD_LIMITS.description_template)
  private_notes?: string | null;
}
