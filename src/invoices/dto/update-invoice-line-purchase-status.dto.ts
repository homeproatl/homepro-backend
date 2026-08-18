import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsEnum,
  IsInt,
  IsMongoId,
  Min,
  ValidateNested,
} from 'class-validator';
import {
  DOCUMENT_FIELD_LIMITS,
  PURCHASE_STATUS_VALUES,
  type PurchaseStatus,
} from '../../documents/schemas/document.schema';

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

export class InvoiceLinePurchaseStatusUpdateDto {
  @IsMongoId()
  line_id!: string;

  @IsEnum(PURCHASE_STATUS_VALUES)
  purchase_status!: PurchaseStatus;
}

export class UpdateInvoiceLinePurchaseStatusDto {
  @Transform(({ value }) => transformInteger(value))
  @IsInt()
  @Min(1)
  version!: number;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(DOCUMENT_FIELD_LIMITS.line_items_max)
  @ValidateNested({ each: true })
  @Type(() => InvoiceLinePurchaseStatusUpdateDto)
  updates!: InvoiceLinePurchaseStatusUpdateDto[];
}
