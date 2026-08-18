import {
  IsDateString,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Min,
} from 'class-validator';

export class CreateManualRefundDto {
  @IsString()
  @IsNotEmpty()
  payment_id!: string;

  @IsInt()
  @Min(1)
  amount_minor!: number;

  @IsString()
  @IsNotEmpty()
  reason!: string;

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
