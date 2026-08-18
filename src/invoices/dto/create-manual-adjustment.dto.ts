import {
  IsDateString,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
} from 'class-validator';

export class CreateManualAdjustmentDto {
  @IsInt()
  amount_minor!: number;

  @IsString()
  @IsNotEmpty()
  reason!: string;

  @IsString()
  @IsOptional()
  note?: string;

  @IsDateString()
  effective_at!: string;

  @IsString()
  @IsNotEmpty()
  idempotency_key!: string;
}
