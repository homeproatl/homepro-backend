import { Transform } from 'class-transformer';
import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

function normalizeVinQueryValue(value: unknown) {
  if (typeof value !== 'string') {
    return value;
  }

  return value.trim().toUpperCase();
}

export class LookupVehicleQueryDto {
  @Transform(({ value }) => normalizeVinQueryValue(value))
  @IsString()
  @IsNotEmpty()
  @MaxLength(32)
  vin!: string;
}
