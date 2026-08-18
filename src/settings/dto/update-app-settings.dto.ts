import { Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsEmail,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { APP_SETTINGS_FIELD_LIMITS } from '../schemas/app-settings.schema';

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

function trimString(value: unknown) {
  return typeof value === 'string' ? value.trim() : value;
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

export class SettingsAddressDto {
  @IsOptional()
  @Transform(({ value }) => trimToNull(value))
  @IsString()
  @MaxLength(200)
  street?: string | null;

  @IsOptional()
  @Transform(({ value }) => trimToNull(value))
  @IsString()
  @MaxLength(120)
  suite?: string | null;

  @IsOptional()
  @Transform(({ value }) => trimToNull(value))
  @IsString()
  @MaxLength(120)
  city?: string | null;

  @IsOptional()
  @Transform(({ value }) => trimToNull(value))
  @IsString()
  @MaxLength(80)
  state?: string | null;

  @IsOptional()
  @Transform(({ value }) => trimToNull(value))
  @IsString()
  @MaxLength(40)
  postal_code?: string | null;

  @IsOptional()
  @Transform(({ value }) => trimToNull(value))
  @IsString()
  @MaxLength(80)
  country?: string | null;
}

export class UpdateAccountSettingsDto {
  @IsOptional()
  @Transform(({ value }) => trimToNull(value))
  @IsString()
  @MaxLength(APP_SETTINGS_FIELD_LIMITS.name)
  first_name?: string | null;

  @IsOptional()
  @Transform(({ value }) => trimToNull(value))
  @IsString()
  @MaxLength(APP_SETTINGS_FIELD_LIMITS.name)
  last_name?: string | null;

  @IsOptional()
  @Transform(({ value }) => trimToNull(value))
  @ValidateIf((_, v) => v != null)
  @IsEmail()
  @MaxLength(APP_SETTINGS_FIELD_LIMITS.email)
  email?: string | null;
}

export class UpdateCompanySettingsDto {
  @IsOptional()
  @Transform(({ value }) => trimToNull(value))
  @IsString()
  @MaxLength(APP_SETTINGS_FIELD_LIMITS.name)
  legal_name?: string | null;

  @IsOptional()
  @Transform(({ value }) => trimToNull(value))
  @IsString()
  @MaxLength(APP_SETTINGS_FIELD_LIMITS.name)
  display_name?: string | null;

  @IsOptional()
  @Transform(({ value }) => trimToNull(value))
  @IsString()
  @MaxLength(APP_SETTINGS_FIELD_LIMITS.phone)
  phone?: string | null;

  @IsOptional()
  @Transform(({ value }) => trimToNull(value))
  @ValidateIf((_, v) => v != null)
  @IsEmail()
  @MaxLength(APP_SETTINGS_FIELD_LIMITS.email)
  email?: string | null;

  @IsOptional()
  @Transform(({ value }) => trimToNull(value))
  @IsString()
  @MaxLength(APP_SETTINGS_FIELD_LIMITS.website)
  website?: string | null;

  @IsOptional()
  @Transform(({ value }) => trimToNull(value))
  @IsString()
  @MaxLength(APP_SETTINGS_FIELD_LIMITS.industry)
  industry?: string | null;

  @IsOptional()
  @ValidateNested()
  @Type(() => SettingsAddressDto)
  address?: SettingsAddressDto | null;

  @IsOptional()
  @Transform(({ value }) => trimToNull(value))
  @IsString()
  @MaxLength(APP_SETTINGS_FIELD_LIMITS.identifier)
  license_number?: string | null;

  @IsOptional()
  @Transform(({ value }) => trimToNull(value))
  @IsString()
  @MaxLength(APP_SETTINGS_FIELD_LIMITS.identifier)
  insurance_number?: string | null;

  @IsOptional()
  @Transform(({ value }) => trimToNull(value))
  @IsString()
  @MaxLength(APP_SETTINGS_FIELD_LIMITS.identifier)
  tax_id?: string | null;

  @IsOptional()
  @Transform(({ value }) => trimToNull(value))
  @IsString()
  @MaxLength(64)
  logo_asset_id?: string | null;
}

export class UpdateDocumentSettingsDto {
  @IsOptional()
  @Transform(({ value }) => trimString(value))
  @IsString()
  @MaxLength(APP_SETTINGS_FIELD_LIMITS.prefix)
  estimate_number_prefix?: string;

  @IsOptional()
  @Transform(({ value }) => trimString(value))
  @IsString()
  @MaxLength(APP_SETTINGS_FIELD_LIMITS.prefix)
  invoice_number_prefix?: string;

  @IsOptional()
  @Transform(({ value }) => transformInteger(value))
  @IsInt()
  @Min(1)
  estimate_next_number?: number;

  @IsOptional()
  @Transform(({ value }) => transformInteger(value))
  @IsInt()
  @Min(1)
  invoice_next_number?: number;

  @IsOptional()
  @Transform(({ value }) => trimToNull(value))
  @IsString()
  @MaxLength(APP_SETTINGS_FIELD_LIMITS.payment_terms)
  default_payment_terms?: string | null;

  @IsOptional()
  @Transform(({ value }) => trimToNull(value))
  @IsString()
  @MaxLength(APP_SETTINGS_FIELD_LIMITS.footer)
  default_footer?: string | null;

  @IsOptional()
  @Transform(({ value }) => trimToNull(value))
  @IsString()
  @MaxLength(APP_SETTINGS_FIELD_LIMITS.notes)
  default_customer_notes?: string | null;

  @IsOptional()
  @Transform(({ value }) => transformInteger(value))
  @IsInt()
  @Min(0)
  @Max(3650)
  default_estimate_expiration_days?: number;

  @IsOptional()
  @Transform(({ value }) => transformInteger(value))
  @IsInt()
  @Min(0)
  @Max(3650)
  default_invoice_due_days?: number;

  @IsOptional()
  @Transform(({ value }) => transformInteger(value))
  @IsInt()
  @Min(0)
  @Max(100_000)
  default_deposit_basis_points?: number;

  @IsOptional()
  @Transform(({ value }) => transformInteger(value))
  @IsInt()
  @Min(0)
  @Max(100_000)
  default_sales_tax_basis_points?: number;

  @IsOptional()
  @Transform(({ value }) => transformBoolean(value))
  @IsBoolean()
  default_show_client_signature?: boolean;

  @IsOptional()
  @Transform(({ value }) => transformBoolean(value))
  @IsBoolean()
  default_show_company_signature?: boolean;

  @IsOptional()
  @Transform(({ value }) => trimToNull(value))
  @IsString()
  @MaxLength(APP_SETTINGS_FIELD_LIMITS.email_message)
  default_estimate_email_message?: string | null;

  @IsOptional()
  @Transform(({ value }) => trimToNull(value))
  @IsString()
  @MaxLength(APP_SETTINGS_FIELD_LIMITS.email_message)
  default_invoice_email_message?: string | null;
}

export class UpdatePreferenceSettingsDto {
  @IsOptional()
  @Transform(({ value }) => trimString(value))
  @IsString()
  @MaxLength(APP_SETTINGS_FIELD_LIMITS.currency)
  currency?: string;

  @IsOptional()
  @Transform(({ value }) => trimString(value))
  @IsString()
  @MaxLength(APP_SETTINGS_FIELD_LIMITS.locale)
  locale?: string;

  @IsOptional()
  @Transform(({ value }) => transformBoolean(value))
  @IsBoolean()
  email_on_estimate_approved?: boolean;

  @IsOptional()
  @Transform(({ value }) => transformBoolean(value))
  @IsBoolean()
  email_on_invoice_paid?: boolean;

  @IsOptional()
  @Transform(({ value }) => transformBoolean(value))
  @IsBoolean()
  email_on_estimate_viewed?: boolean;

  @IsOptional()
  @Transform(({ value }) => transformBoolean(value))
  @IsBoolean()
  email_on_invoice_viewed?: boolean;
}

export class UpdateAppSettingsDto {
  @IsOptional()
  @IsString()
  business_timezone?: string;

  @IsOptional()
  @ValidateNested()
  @Type(() => UpdateAccountSettingsDto)
  account?: UpdateAccountSettingsDto;

  @IsOptional()
  @ValidateNested()
  @Type(() => UpdateCompanySettingsDto)
  company?: UpdateCompanySettingsDto;

  @IsOptional()
  @ValidateNested()
  @Type(() => UpdateDocumentSettingsDto)
  documents?: UpdateDocumentSettingsDto;

  @IsOptional()
  @ValidateNested()
  @Type(() => UpdatePreferenceSettingsDto)
  preferences?: UpdatePreferenceSettingsDto;
}
