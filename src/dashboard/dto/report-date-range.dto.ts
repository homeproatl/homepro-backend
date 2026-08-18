import { IsISO8601, IsOptional } from 'class-validator';

export class ReportDateRangeDto {
  @IsOptional()
  @IsISO8601({ strict: true })
  date_from?: string;

  @IsOptional()
  @IsISO8601({ strict: true })
  date_to?: string;
}
