import {
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Min,
  ValidateIf,
} from 'class-validator';

export class CreateServiceDto {
  @IsString()
  name!: string;

  @IsNumber()
  @Min(0)
  base_price!: number;

  @ValidateIf((_object, value) => value !== undefined)
  @IsOptional()
  @IsInt()
  @Min(1)
  estimated_duration_minutes?: number;
}
