import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsDateString,
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
  ValidateNested,
} from 'class-validator';
import {
  MARKUP_TYPE_VALUES,
  type MarkupType,
} from '../../items/schemas/item.schema';
import { DOCUMENT_TYPE_VALUES, type DocumentType } from '../document-status';
import { AddressDto } from '../../clients/dto/create-client.dto';
import {
  DOCUMENT_FIELD_LIMITS,
  DOCUMENT_LINE_TYPE_VALUES,
  PURCHASE_STATUS_VALUES,
  type DocumentLineType,
  type PurchaseStatus,
} from '../schemas/document.schema';

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

export class DocumentLineItemWriteDto {
  /** Existing line id; when present and owned by the document, preserve `_id`. */
  @IsOptional()
  @ValidateIf((_, value) => value !== null && value !== undefined)
  @IsMongoId()
  id?: string | null;

  @IsOptional()
  @ValidateIf((_, value) => value !== null && value !== undefined)
  @IsMongoId()
  item_id?: string | null;

  @Transform(({ value }) => transformInteger(value))
  @IsInt()
  @Min(0)
  sort_order!: number;

  @IsEnum(DOCUMENT_LINE_TYPE_VALUES)
  line_type!: DocumentLineType;

  @Transform(({ value }) => trimRequiredString(value))
  @IsString()
  @MinLength(1)
  @MaxLength(DOCUMENT_FIELD_LIMITS.description)
  description!: string;

  @IsOptional()
  @Transform(({ value }) => trimToNull(value))
  @ValidateIf((_, value) => value !== null && value !== undefined)
  @IsString()
  @MaxLength(DOCUMENT_FIELD_LIMITS.notes)
  notes?: string | null;

  @IsOptional()
  @Transform(({ value }) => trimToNull(value))
  @ValidateIf((_, value) => value !== null && value !== undefined)
  @IsString()
  @MaxLength(DOCUMENT_FIELD_LIMITS.unit_of_measure)
  unit_of_measure?: string | null;

  @IsOptional()
  @Transform(({ value }) => trimToNull(value))
  @ValidateIf((_, value) => value !== null && value !== undefined)
  @IsString()
  @MaxLength(DOCUMENT_FIELD_LIMITS.sku_or_part_number)
  sku_or_part_number?: string | null;

  @IsOptional()
  @Transform(({ value }) => trimToNull(value))
  @ValidateIf((_, value) => value !== null && value !== undefined)
  @IsString()
  @MaxLength(DOCUMENT_FIELD_LIMITS.vendor_name)
  vendor_name?: string | null;

  @IsOptional()
  @IsEnum(PURCHASE_STATUS_VALUES)
  purchase_status?: PurchaseStatus;

  @IsOptional()
  @Transform(({ value }) => transformNullableInteger(value))
  @ValidateIf((_, value) => value !== null && value !== undefined)
  @IsInt()
  @Min(0)
  @Max(DOCUMENT_FIELD_LIMITS.rate_minor_max)
  internal_unit_cost_minor?: number | null;

  @IsOptional()
  @Transform(({ value }) => transformInteger(value))
  @IsInt()
  @Min(0)
  @Max(DOCUMENT_FIELD_LIMITS.waste_basis_points_max)
  waste_basis_points?: number;

  @Transform(({ value }) => transformInteger(value))
  @IsInt()
  @Min(0)
  @Max(DOCUMENT_FIELD_LIMITS.rate_minor_max)
  rate_minor!: number;

  @Transform(({ value }) => transformInteger(value))
  @IsInt()
  @Min(1)
  @Max(DOCUMENT_FIELD_LIMITS.quantity_milli_max)
  quantity_milli!: number;

  @IsOptional()
  @IsEnum(MARKUP_TYPE_VALUES)
  markup_type?: MarkupType;

  @IsOptional()
  @Transform(({ value }) => transformInteger(value))
  @IsInt()
  @Min(0)
  @Max(DOCUMENT_FIELD_LIMITS.markup_value_max)
  markup_value?: number;

  @IsOptional()
  @IsEnum(MARKUP_TYPE_VALUES)
  discount_type?: MarkupType;

  @IsOptional()
  @Transform(({ value }) => transformInteger(value))
  @IsInt()
  @Min(0)
  @Max(DOCUMENT_FIELD_LIMITS.markup_value_max)
  discount_value?: number;

  @IsOptional()
  @Transform(({ value }) => transformBoolean(value))
  @IsBoolean()
  taxable?: boolean;

  @IsOptional()
  @ValidateIf((_, value) => value !== null && value !== undefined)
  @IsMongoId()
  tax_id?: string | null;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(8)
  @ArrayUnique()
  @IsMongoId({ each: true })
  tax_ids?: string[];

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @IsMongoId({ each: true })
  photo_asset_ids?: string[];
}

export class CreateDocumentDto {
  @IsEnum(DOCUMENT_TYPE_VALUES)
  type!: DocumentType;

  @IsMongoId()
  client_id!: string;

  @IsOptional()
  @Transform(({ value }) => trimToNull(value))
  @ValidateIf((_, value) => value !== null && value !== undefined)
  @IsString()
  @MaxLength(DOCUMENT_FIELD_LIMITS.po_number)
  po_number?: string | null;

  @IsOptional()
  @Transform(({ value }) => trimToNull(value))
  @ValidateIf((_, value) => value !== null && value !== undefined)
  @IsString()
  @MaxLength(DOCUMENT_FIELD_LIMITS.job_name)
  job_name?: string | null;

  @IsOptional()
  @ValidateNested()
  @Type(() => AddressDto)
  service_address_snapshot?: AddressDto | null;

  @IsOptional()
  @IsDateString()
  issue_date?: string | null;

  @IsOptional()
  @IsDateString()
  expiration_date?: string | null;

  @IsOptional()
  @IsDateString()
  due_date?: string | null;

  @IsOptional()
  @ValidateIf((_, value) => value !== null && value !== undefined)
  @IsMongoId()
  contract_template_id?: string | null;

  @IsOptional()
  @Transform(({ value }) => transformBoolean(value))
  @IsBoolean()
  show_client_signature?: boolean;

  @IsOptional()
  @Transform(({ value }) => transformBoolean(value))
  @IsBoolean()
  show_company_signature?: boolean;

  @IsOptional()
  @Transform(({ value }) => transformBoolean(value))
  @IsBoolean()
  online_payments_enabled?: boolean;

  @IsOptional()
  @Transform(({ value }) => trimToNull(value))
  @ValidateIf((_, value) => value !== null && value !== undefined)
  @IsString()
  @MaxLength(DOCUMENT_FIELD_LIMITS.customer_notes)
  customer_notes?: string | null;

  @IsOptional()
  @Transform(({ value }) => trimToNull(value))
  @ValidateIf((_, value) => value !== null && value !== undefined)
  @IsString()
  @MaxLength(DOCUMENT_FIELD_LIMITS.private_notes)
  private_notes?: string | null;

  @IsOptional()
  @Transform(({ value }) => transformInteger(value))
  @IsInt()
  @Min(0)
  @Max(DOCUMENT_FIELD_LIMITS.rate_minor_max)
  deposit_requested_minor?: number;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(50)
  @IsMongoId({ each: true })
  document_photo_asset_ids?: string[];

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(50)
  @IsMongoId({ each: true })
  attachment_asset_ids?: string[];

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(DOCUMENT_FIELD_LIMITS.line_items_max)
  @ValidateNested({ each: true })
  @Type(() => DocumentLineItemWriteDto)
  line_items!: DocumentLineItemWriteDto[];
}
