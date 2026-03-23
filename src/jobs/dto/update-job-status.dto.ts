import { IsEnum } from 'class-validator';
import { JobStatus } from '../../common/enums/job-status.enum';

export class UpdateJobStatusDto {
  @IsEnum(JobStatus)
  job_status!: JobStatus;
}
