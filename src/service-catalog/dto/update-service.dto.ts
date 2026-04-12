import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsEnum,
  IsOptional,
  IsNumber,
  IsString,
  MinLength,
  MaxLength,
  Min,
  Max,
  ValidateNested,
} from 'class-validator';
import { TAG_COLOR_VALUES, type TagColor } from '../../tags/tag-colors';
import { TAG_SCOPE_VALUES, type TagScope } from '../../tags/tag-scopes';

class UpdateLineTagDto {
  @IsOptional()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  id?: string | null;

  @IsEnum(TAG_SCOPE_VALUES)
  scope!: TagScope;

  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @MinLength(1)
  @MaxLength(40)
  name!: string;

  @IsEnum(TAG_COLOR_VALUES)
  color!: TagColor;
}

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

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(12)
  @ValidateNested({ each: true })
  @Type(() => UpdateLineTagDto)
  tags?: UpdateLineTagDto[];
}

class UpdateServicePartLineDto {
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @MinLength(1)
  @MaxLength(160)
  name!: string;

  @IsOptional()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @MaxLength(120)
  part_number?: string | null;

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

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(12)
  @ValidateNested({ each: true })
  @Type(() => UpdateLineTagDto)
  tags?: UpdateLineTagDto[];
}

export class UpdateServiceDto {
  @IsOptional()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @MinLength(1)
  @MaxLength(160)
  name?: string;

  @IsOptional()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @MaxLength(2000)
  note?: string | null;

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
