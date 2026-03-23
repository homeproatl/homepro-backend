import {
  IsDateString,
  IsEnum,
  IsMongoId,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';
import { PaymentType } from '../../common/enums/payment-type.enum';

export class UpdateJobDto {
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
  @IsEnum(PaymentType)
  payment_type?: PaymentType;

  @IsOptional()
  @IsDateString()
  due_date?: string | null;
}
