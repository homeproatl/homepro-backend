import { IsInt, IsOptional, IsString, Min } from 'class-validator';

export class CreateJobServiceDto {
  @IsString()
  service_id!: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  quantity?: number;
}
