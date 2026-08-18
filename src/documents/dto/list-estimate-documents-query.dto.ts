import { Transform } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsDateString,
  IsEnum,
  IsIn,
  IsInt,
  IsMongoId,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { ESTIMATE_STATUSES, type EstimateStatus } from '../document-status';
import {
  DOCUMENT_FIELD_LIMITS,
  EMAIL_STATE_VALUES,
  type EmailState,
} from '../schemas/document.schema';

export const ESTIMATE_LIST_SORT_FIELDS = [
  'issue_date',
  'total_minor',
  'number',
  'created_at',
  'updated_at',
] as const;
export type EstimateListSortField = (typeof ESTIMATE_LIST_SORT_FIELDS)[number];

export const ESTIMATE_LIST_SORT_DIRECTIONS = ['asc', 'desc'] as const;
export type EstimateListSortDirection =
  (typeof ESTIMATE_LIST_SORT_DIRECTIONS)[number];

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

/**
 * Accepts repeated query keys (`status=draft&status=pending`), CSV
 * (`status=draft,pending`), or a single status string.
 */
function transformStatusList(value: unknown): string[] | undefined {
  if (value === undefined || value === null || value === '') {
    return undefined;
  }
  const rawValues = Array.isArray(value) ? value : [value];
  const statuses = rawValues
    .flatMap((entry) => String(entry).split(','))
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
  return statuses.length > 0 ? [...new Set(statuses)] : undefined;
}

/**
 * Paginated estimate list filters over the documents aggregate (type=estimate).
 * Used by `GET /estimates?paginated=true` (Step 8).
 */
export class ListEstimateDocumentsQueryDto {
  @IsOptional()
  @Transform(({ value }) => transformStatusList(value))
  @IsArray()
  @ArrayMaxSize(ESTIMATE_STATUSES.length)
  @IsEnum(ESTIMATE_STATUSES, { each: true })
  status?: EstimateStatus[];

  @IsOptional()
  @IsMongoId()
  client_id?: string;

  @IsOptional()
  @Transform(({ value }) => normalizeSearchValue(value))
  @IsString()
  @MaxLength(120)
  search?: string;

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
  @IsEnum(EMAIL_STATE_VALUES)
  email_state?: EmailState;

  @IsOptional()
  @IsIn(ESTIMATE_LIST_SORT_FIELDS)
  sort?: EstimateListSortField;

  @IsOptional()
  @IsIn(ESTIMATE_LIST_SORT_DIRECTIONS)
  direction?: EstimateListSortDirection;

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
