import { IsDateString, IsEnum, IsMongoId, IsOptional } from 'class-validator';
import { EstimateStatus } from '../../common/enums/estimate-status.enum';

export class CalendarEstimatesQueryDto {
  @IsOptional()
  @IsDateString()
  date_from?: string;

  @IsOptional()
  @IsDateString()
  date_to?: string;

  @IsOptional()
  @IsMongoId()
  assigned_user_id?: string;

  @IsOptional()
  @IsEnum(EstimateStatus)
  status?: EstimateStatus;
}
