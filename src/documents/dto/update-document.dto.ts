import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsDateString,
  IsInt,
  IsMongoId,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { AddressDto } from '../../clients/dto/create-client.dto';
import { DOCUMENT_FIELD_LIMITS } from '../schemas/document.schema';
import { DocumentLineItemWriteDto } from './create-document.dto';

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

export class UpdateDocumentDto {
  @Transform(({ value }) => transformInteger(value))
  @IsInt()
  @Min(1)
  version!: number;

  @IsOptional()
  @IsMongoId()
  client_id?: string;

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
  @ValidateIf((_, value) => value !== null && value !== undefined)
  @IsDateString()
  issue_date?: string | null;

  @IsOptional()
  @ValidateIf((_, value) => value !== null && value !== undefined)
  @IsDateString()
  expiration_date?: string | null;

  @IsOptional()
  @ValidateIf((_, value) => value !== null && value !== undefined)
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
  @Transform(({ value }) => transformBoolean(value))
  @IsBoolean()
  refresh_snapshots?: boolean;

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

  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(DOCUMENT_FIELD_LIMITS.line_items_max)
  @ValidateNested({ each: true })
  @Type(() => DocumentLineItemWriteDto)
  line_items?: DocumentLineItemWriteDto[];
}
