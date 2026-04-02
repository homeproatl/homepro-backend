import { Transform, Type } from 'class-transformer';
import {
  ArrayMinSize,
  ArrayMaxSize,
  IsArray,
  IsDateString,
  IsEnum,
  IsMongoId,
  IsNumber,
  IsOptional,
  IsString,
  MinLength,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { PaidStatus } from '../../common/enums/paid-status.enum';
import { PaymentType } from '../../common/enums/payment-type.enum';
import { EstimateStatus } from '../../common/enums/estimate-status.enum';

export class CreateEstimateLaborLineDto {
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @MinLength(1)
  @MaxLength(160)
  description!: string;

  @IsOptional()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsMongoId()
  assigned_user_id?: string | null;

  @Type(() => Number)
  @IsNumber()
  @Min(0)
  hours!: number;

  @Type(() => Number)
  @IsNumber()
  @Min(0)
  rate!: number;

  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(100)
  discount_percent = 0;
}

export class CreateEstimatePartLineDto {
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @MinLength(1)
  @MaxLength(160)
  name!: string;

  @Type(() => Number)
  @IsNumber()
  @Min(1)
  quantity!: number;

  @Type(() => Number)
  @IsNumber()
  @Min(0)
  price!: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  cost?: number | null;

  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(100)
  discount_percent = 0;
}

export class CreateEstimateServiceDto {
  @IsOptional()
  @IsMongoId()
  canned_service_id?: string | null;

  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @MinLength(1)
  @MaxLength(160)
  name!: string;

  @IsArray()
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => CreateEstimateLaborLineDto)
  labor_lines!: CreateEstimateLaborLineDto[];

  @IsArray()
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => CreateEstimatePartLineDto)
  part_lines!: CreateEstimatePartLineDto[];
}

export class CreateEstimateDto {
  @IsString()
  @MaxLength(120)
  title!: string;

  @IsMongoId()
  customer_id!: string;

  @IsMongoId()
  vehicle_id!: string;

  @IsOptional()
  @IsDateString()
  scheduled_start?: string;

  @IsOptional()
  @IsDateString()
  scheduled_end?: string;

  @IsOptional()
  @IsMongoId()
  assigned_user_id?: string;

  @IsOptional()
  @IsString()
  complaint_or_request?: string;

  @IsOptional()
  @IsString()
  notes?: string;

  @IsOptional()
  @IsEnum(EstimateStatus)
  estimate_status?: EstimateStatus;

  @IsOptional()
  @IsEnum(PaidStatus)
  payment_status?: PaidStatus;

  @IsOptional()
  @IsEnum(PaymentType)
  payment_type?: PaymentType;

  @IsOptional()
  @IsDateString()
  due_date?: string;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => CreateEstimateServiceDto)
  services!: CreateEstimateServiceDto[];
}
