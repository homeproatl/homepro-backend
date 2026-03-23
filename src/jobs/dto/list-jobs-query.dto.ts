import { Transform } from 'class-transformer';
import { IsBoolean, IsIn, IsMongoId, IsOptional } from 'class-validator';
import { JobInvoiceSnapshotStatus } from '../enums/job-invoice-snapshot-status.enum';

export const JOB_INVOICE_LIST_STATUSES = [
  ...Object.values(JobInvoiceSnapshotStatus),
  'NONE',
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

export class ListJobsQueryDto {
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
  @Transform(({ value }) => transformBoolean(value))
  @IsBoolean()
  ready_to_invoice?: boolean;

  @IsOptional()
  @Transform(({ value }) => transformBoolean(value))
  @IsBoolean()
  overdue?: boolean;
}
