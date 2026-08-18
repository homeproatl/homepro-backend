import { Transform } from 'class-transformer';
import {
  IsEnum,
  IsInt,
  IsMongoId,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { DOCUMENT_FIELD_LIMITS } from '../../documents/schemas/document.schema';

const INVOICE_SEGMENT_VALUES = ['active', 'paid', 'overdue', 'all'] as const;

function normalizeSearchValue(value: unknown) {
  if (typeof value !== 'string') {
    return value;
  }
  const trimmedValue = value.trim();
  return trimmedValue.length > 0 ? trimmedValue : undefined;
}

function transformNumber(value: unknown) {
  if (value === undefined || value === null || value === '') {
    return undefined;
  }
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : value;
}

export class ListInvoicesQueryDto {
  /** Single status or comma-separated list (draft,issued,sent). */
  @IsOptional()
  @IsString()
  status?: string;

  @IsOptional()
  @IsEnum(INVOICE_SEGMENT_VALUES)
  segment?: (typeof INVOICE_SEGMENT_VALUES)[number];

  @IsOptional()
  @IsMongoId()
  client_id?: string;

  @IsOptional()
  @IsMongoId()
  source_estimate_id?: string;

  @IsOptional()
  @Transform(({ value }) => normalizeSearchValue(value))
  @IsString()
  @MaxLength(120)
  search?: string;

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
