import { IsEnum } from 'class-validator';
import { PaidStatus } from '../../common/enums/paid-status.enum';

export class UpdateEstimatePaymentStatusDto {
  @IsEnum(PaidStatus)
  payment_status!: PaidStatus;
}
