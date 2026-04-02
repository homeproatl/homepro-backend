import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsOptional,
  IsNumber,
  IsString,
  MinLength,
  MaxLength,
  Min,
  Max,
  ValidateNested,
} from 'class-validator';

class UpdateServiceLaborLineDto {
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @MinLength(1)
  @MaxLength(160)
  description!: string;

  @IsNumber()
  @Min(0)
  hours!: number;

  @IsNumber()
  @Min(0)
  rate!: number;

  @IsNumber()
  @Min(0)
  @Max(100)
  discount_percent = 0;
}

class UpdateServicePartLineDto {
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @MinLength(1)
  @MaxLength(160)
  name!: string;

  @IsNumber()
  @Min(1)
  quantity!: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  cost?: number | null;

  @Type(() => Number)
  @IsNumber()
  @Min(0)
  price!: number;

  @IsNumber()
  @Min(0)
  @Max(100)
  discount_percent = 0;
}

export class UpdateServiceDto {
  @IsOptional()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @MinLength(1)
  @MaxLength(160)
  name?: string;

  @IsOptional()
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => UpdateServiceLaborLineDto)
  labor_lines?: UpdateServiceLaborLineDto[];

  @IsOptional()
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => UpdateServicePartLineDto)
  part_lines?: UpdateServicePartLineDto[];
}
