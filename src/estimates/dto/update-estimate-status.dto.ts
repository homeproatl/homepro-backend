import { IsEnum } from 'class-validator';
import { EstimateStatus } from '../../common/enums/estimate-status.enum';

export class UpdateEstimateStatusDto {
  @IsEnum(EstimateStatus)
  estimate_status!: EstimateStatus;
}
