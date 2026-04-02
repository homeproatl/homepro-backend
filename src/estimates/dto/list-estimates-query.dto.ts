import { Transform } from 'class-transformer';
import { IsBoolean, IsIn, IsMongoId, IsOptional } from 'class-validator';
import { EstimateInvoiceSnapshotStatus } from '../enums/estimate-invoice-snapshot-status.enum';

export const JOB_INVOICE_LIST_STATUSES = [
  ...Object.values(EstimateInvoiceSnapshotStatus),
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
  @Transform(({ value }) => transformBoolean(value))
  @IsBoolean()
  ready_to_invoice?: boolean;

  @IsOptional()
  @Transform(({ value }) => transformBoolean(value))
  @IsBoolean()
  overdue?: boolean;
}
