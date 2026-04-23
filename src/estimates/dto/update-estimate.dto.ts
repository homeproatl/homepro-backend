import { Type } from 'class-transformer';
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
  Min,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { EstimateStatus } from '../../common/enums/estimate-status.enum';
import { PaymentType } from '../../common/enums/payment-type.enum';
import {
  CreateEstimateServiceDto,
} from './create-estimate.dto';

export class UpdateEstimateDto {
  @IsOptional()
  @IsString()
  @MaxLength(120)
  title?: string;

  @IsOptional()
  @IsMongoId()
  customer_id?: string;

  @IsOptional()
  @IsMongoId()
  vehicle_id?: string;

  @IsOptional()
  @IsDateString()
  scheduled_start?: string | null;

  @IsOptional()
  @IsDateString()
  scheduled_end?: string | null;

  @IsOptional()
  @IsMongoId()
  assigned_user_id?: string | null;

  @IsOptional()
  @IsString()
  complaint_or_request?: string | null;

  @IsOptional()
  @IsString()
  notes?: string | null;

  @IsOptional()
  @IsEnum(EstimateStatus)
  estimate_status?: EstimateStatus;

  @IsOptional()
  @IsEnum(PaymentType)
  payment_type?: PaymentType;

  @IsOptional()
  @IsDateString()
  due_date?: string | null;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  subtotal?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  tax_rate?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  tax_amount?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  total?: number;

  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => CreateEstimateServiceDto)
  services?: CreateEstimateServiceDto[];
}
