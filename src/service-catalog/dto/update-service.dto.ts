import {
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Min,
  ValidateIf,
} from 'class-validator';

export class UpdateServiceDto {
  @IsOptional()
  @IsString()
  name?: string;

  @ValidateIf((_object, value) => value !== undefined)
  @IsNumber()
  @Min(0)
  base_price?: number;

  @ValidateIf((_object, value) => value !== undefined)
  @IsOptional()
  @IsInt()
  @Min(1)
  estimated_duration_minutes?: number | null;
}
