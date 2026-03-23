import {
  IsDateString,
  IsEnum,
  IsMongoId,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';
import { PaidStatus } from '../../common/enums/paid-status.enum';
import { PaymentType } from '../../common/enums/payment-type.enum';
import { JobStatus } from '../../common/enums/job-status.enum';

export class CreateJobDto {
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
  @IsEnum(JobStatus)
  job_status?: JobStatus;

  @IsOptional()
  @IsEnum(PaidStatus)
  payment_status?: PaidStatus;

  @IsOptional()
  @IsEnum(PaymentType)
  payment_type?: PaymentType;

  @IsOptional()
  @IsDateString()
  due_date?: string;
}
