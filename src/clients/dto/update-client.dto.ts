import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsEmail,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { AddressDto } from './create-client.dto';
import { CLIENT_FIELD_LIMITS } from '../schemas/client.schema';

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

function normalizePhoneDisplay(value: unknown) {
  const trimmed = trimToNull(value);
  if (typeof trimmed !== 'string') {
    return trimmed;
  }
  return trimmed.replace(/\s+/g, ' ');
}

const JOIST_COMPATIBLE_PHONE = /^(?=(?:\D*\d){7,15}\D*$)[+()\d\s.-]+$/;

export class UpdateClientDto {
  @IsOptional()
  @Transform(({ value }) => trimToNull(value))
  @IsString()
  @MaxLength(CLIENT_FIELD_LIMITS.display_name)
  display_name?: string | null;

  @IsOptional()
  @Transform(({ value }) => trimToNull(value))
  @IsString()
  @MaxLength(CLIENT_FIELD_LIMITS.first_name)
  first_name?: string | null;

  @IsOptional()
  @Transform(({ value }) => trimToNull(value))
  @IsString()
  @MaxLength(CLIENT_FIELD_LIMITS.last_name)
  last_name?: string | null;

  @IsOptional()
  @Transform(({ value }) => trimToNull(value))
  @IsString()
  @MaxLength(CLIENT_FIELD_LIMITS.company_name)
  company_name?: string | null;

  @IsOptional()
  @Transform(({ value }) => normalizePhoneDisplay(value))
  @ValidateIf((_, value) => value !== null && value !== undefined)
  @IsString()
  @Matches(JOIST_COMPATIBLE_PHONE, {
    message: 'phone must contain 7 to 15 digits and valid phone punctuation',
  })
  @MaxLength(CLIENT_FIELD_LIMITS.phone)
  phone?: string | null;

  @IsOptional()
  @Transform(({ value }) => normalizePhoneDisplay(value))
  @ValidateIf((_, value) => value !== null && value !== undefined)
  @IsString()
  @Matches(JOIST_COMPATIBLE_PHONE, {
    message:
      'secondary_phone must contain 7 to 15 digits and valid phone punctuation',
  })
  @MaxLength(CLIENT_FIELD_LIMITS.secondary_phone)
  secondary_phone?: string | null;

  @IsOptional()
  @Transform(({ value }) => {
    const trimmed = trimToNull(value);
    return typeof trimmed === 'string' ? trimmed.toLowerCase() : trimmed;
  })
  @ValidateIf((_, value) => value !== null && value !== undefined)
  @IsEmail()
  @MaxLength(CLIENT_FIELD_LIMITS.email)
  email?: string | null;

  @IsOptional()
  @ValidateNested()
  @Type(() => AddressDto)
  billing_address?: AddressDto | null;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(CLIENT_FIELD_LIMITS.service_addresses)
  @ValidateNested({ each: true })
  @Type(() => AddressDto)
  service_addresses?: AddressDto[];

  @IsOptional()
  @Transform(({ value }) => trimToNull(value))
  @IsString()
  @MaxLength(CLIENT_FIELD_LIMITS.notes)
  notes?: string | null;
}
