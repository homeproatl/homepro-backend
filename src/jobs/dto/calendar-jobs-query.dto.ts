import { IsDateString, IsEnum, IsMongoId, IsOptional } from 'class-validator';
import { JobStatus } from '../../common/enums/job-status.enum';

export class CalendarJobsQueryDto {
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
  @IsEnum(JobStatus)
  status?: JobStatus;
}
