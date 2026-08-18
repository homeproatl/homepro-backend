import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsEnum,
  IsInt,
  IsMongoId,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import {
  ALL_DOCUMENT_STATUSES,
  DOCUMENT_TYPE_VALUES,
  type DocumentStatus,
  type DocumentType,
} from '../document-status';
import { DOCUMENT_FIELD_LIMITS } from '../schemas/document.schema';

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

export class ListDocumentsQueryDto {
  @IsOptional()
  @IsEnum(DOCUMENT_TYPE_VALUES)
  type?: DocumentType;

  @IsOptional()
  @IsEnum(ALL_DOCUMENT_STATUSES)
  status?: DocumentStatus;

  @IsOptional()
  @IsMongoId()
  client_id?: string;

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
  @Max(DOCUMENT_FIELD_LIMITS.page_size_max)
  page_size?: number;
}
