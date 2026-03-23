import { IsEnum } from 'class-validator';
import { PaidStatus } from '../../common/enums/paid-status.enum';

export class UpdateJobPaymentStatusDto {
  @IsEnum(PaidStatus)
  payment_status!: PaidStatus;
}
