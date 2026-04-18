import { Type } from 'class-transformer';
import { IsEnum, IsNumber, IsOptional, Min } from 'class-validator';
import { PaidStatus } from '../../common/enums/paid-status.enum';

export class UpdateEstimatePaymentStatusDto {
  @IsEnum(PaidStatus)
  payment_status!: PaidStatus;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  payment_amount?: number;
}
