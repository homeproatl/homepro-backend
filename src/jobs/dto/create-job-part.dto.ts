import { IsInt, IsNumber, IsOptional, IsString, Min } from 'class-validator';

export class CreateJobPartDto {
  @IsString()
  part_name!: string;

  @IsInt()
  @Min(1)
  quantity!: number;

  @IsNumber()
  @Min(0)
  unit_price!: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  cost?: number;
}
