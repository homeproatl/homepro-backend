import { IsInt, IsOptional, IsString, MaxLength, Min } from 'class-validator';

export class UpdateVehicleDto {
  @IsOptional()
  @IsString()
  customer_id?: string;

  @IsOptional()
  @IsString()
  color?: string | null;

  @IsOptional()
  @IsInt()
  @Min(1900)
  year?: number | null;

  @IsOptional()
  @IsString()
  make?: string;

  @IsOptional()
  @IsString()
  model?: string;

  @IsOptional()
  @IsString()
  sub_model?: string | null;

  @IsOptional()
  @IsInt()
  @Min(0)
  mileage?: number | null;

  @IsOptional()
  @IsString()
  @MaxLength(32)
  vin?: string;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  license_plate?: string;
}
