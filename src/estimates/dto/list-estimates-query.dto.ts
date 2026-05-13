import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsMongoId,
  IsOptional,
  IsString,
  Max,
  Min,
} from 'class-validator';
import { EstimateInvoiceSnapshotStatus } from '../enums/estimate-invoice-snapshot-status.enum';
import { EstimateStatus } from '../../common/enums/estimate-status.enum';

export const JOB_INVOICE_LIST_STATUSES = [
  ...Object.values(EstimateInvoiceSnapshotStatus),
  'NONE',
] as const;
export const ESTIMATE_ADMIN_INVOICE_WORKFLOW_STATES = [
  'blocked',
  'ready_to_send',
  'sent',
  'needs_resend',
] as const;

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

export const ESTIMATE_LIST_SORT_MODES = ['nearest_upcoming', 'newest'] as const;
export const ESTIMATE_LIST_STATUS_FILTERS = [
  ...Object.values(EstimateStatus),
  'active',
] as const;

export class ListEstimatesQueryDto {
  @IsOptional()
  @IsMongoId()
  customer_id?: string;

  @IsOptional()
  @IsMongoId()
  vehicle_id?: string;

  @IsOptional()
  @IsIn(JOB_INVOICE_LIST_STATUSES)
  invoice_status?: (typeof JOB_INVOICE_LIST_STATUSES)[number];

  @IsOptional()
  @IsIn(ESTIMATE_ADMIN_INVOICE_WORKFLOW_STATES)
  admin_invoice_workflow_state?:
    (typeof ESTIMATE_ADMIN_INVOICE_WORKFLOW_STATES)[number];

  @IsOptional()
  @Transform(({ value }) => transformBoolean(value))
  @IsBoolean()
  ready_to_invoice?: boolean;

  @IsOptional()
  @Transform(({ value }) => transformBoolean(value))
  @IsBoolean()
  overdue?: boolean;

  @IsOptional()
  @IsString()
  search?: string;

  @IsOptional()
  @IsIn(ESTIMATE_LIST_STATUS_FILTERS)
  status?: (typeof ESTIMATE_LIST_STATUS_FILTERS)[number];

  @IsOptional()
  @IsIn(ESTIMATE_LIST_SORT_MODES)
  sort?: (typeof ESTIMATE_LIST_SORT_MODES)[number];

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
