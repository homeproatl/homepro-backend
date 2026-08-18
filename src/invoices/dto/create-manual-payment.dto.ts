import {
  IsDateString,
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Min,
} from 'class-validator';
import {
  PAYMENT_METHOD_VALUES,
  PAYMENT_PURPOSE_VALUES,
  type PaymentMethod,
  type PaymentPurpose,
} from '../schemas/payment.schema';

export class CreateManualPaymentDto {
  @IsInt()
  @Min(1)
  amount_minor!: number;

  @IsEnum(PAYMENT_METHOD_VALUES)
  method!: PaymentMethod;

  @IsEnum(PAYMENT_PURPOSE_VALUES)
  @IsOptional()
  purpose?: PaymentPurpose;

  @IsString()
  @IsOptional()
  reference?: string;

  @IsString()
  @IsOptional()
  note?: string;

  @IsDateString()
  effective_at!: string;

  @IsString()
  @IsNotEmpty()
  idempotency_key!: string;
}
