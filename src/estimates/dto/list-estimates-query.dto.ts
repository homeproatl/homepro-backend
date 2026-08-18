import { Transform } from 'class-transformer';
import {
  IsDateString,
  IsIn,
  IsInt,
  IsMongoId,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import {
  ESTIMATE_LIST_SORT_DIRECTIONS,
  ESTIMATE_LIST_SORT_FIELDS,
} from '../../documents/dto/list-estimate-documents-query.dto';
import {
  DOCUMENT_FIELD_LIMITS,
  EMAIL_STATE_VALUES,
} from '../../documents/schemas/document.schema';

function transformNumber(value: unknown) {
  if (value === undefined || value === null || value === '') {
    return undefined;
  }
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : value;
}

function normalizeSearchValue(value: unknown) {
  if (typeof value !== 'string') {
    return value;
  }
  const trimmedValue = value.trim();
  return trimmedValue.length > 0 ? trimmedValue : undefined;
}

/**
 * Accepts repeated or comma-separated status values.
 */
function transformStatusQuery(value: unknown): string | string[] | undefined {
  if (value === undefined || value === null || value === '') {
    return undefined;
  }
  const rawValues = Array.isArray(value) ? value : [value];
  const statuses = rawValues
    .flatMap((entry) => String(entry).split(','))
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
  if (statuses.length === 0) {
    return undefined;
  }
  if (statuses.length === 1) {
    return statuses[0];
  }
  return [...new Set(statuses)];
}

export class ListEstimatesQueryDto {
  @IsOptional()
  @IsMongoId()
  client_id?: string;

  @IsOptional()
  @Transform(({ value }) => normalizeSearchValue(value))
  @IsString()
  @MaxLength(120)
  search?: string;

  @IsOptional()
  @Transform(({ value }) => transformStatusQuery(value))
  status?: string | string[];

  @IsOptional()
  @IsIn(ESTIMATE_LIST_SORT_FIELDS)
  sort?: string;

  @IsOptional()
  @IsIn(ESTIMATE_LIST_SORT_DIRECTIONS)
  direction?: (typeof ESTIMATE_LIST_SORT_DIRECTIONS)[number];

  @IsOptional()
  @IsDateString()
  date_from?: string;

  @IsOptional()
  @IsDateString()
  date_to?: string;

  @IsOptional()
  @Transform(({ value }) => transformNumber(value))
  @IsInt()
  @Min(0)
  @Max(DOCUMENT_FIELD_LIMITS.rate_minor_max)
  amount_min_minor?: number;

  @IsOptional()
  @Transform(({ value }) => transformNumber(value))
  @IsInt()
  @Min(0)
  @Max(DOCUMENT_FIELD_LIMITS.rate_minor_max)
  amount_max_minor?: number;

  @IsOptional()
  @IsIn(EMAIL_STATE_VALUES)
  email_state?: (typeof EMAIL_STATE_VALUES)[number];

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
