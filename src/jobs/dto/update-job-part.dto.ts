import { IsInt, IsNumber, IsOptional, IsString, Min } from 'class-validator';

export class UpdateJobPartDto {
  @IsOptional()
  @IsString()
  part_name?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  quantity?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  unit_price?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  cost?: number | null;
}
