import { IsInt, IsOptional, IsString, Min } from 'class-validator';

export class UpdateJobServiceDto {
  @IsOptional()
  @IsString()
  service_id?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  quantity?: number;
}
