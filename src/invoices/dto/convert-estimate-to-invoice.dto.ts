import { IsDateString, IsOptional, IsString, MaxLength } from 'class-validator';

export class ConvertEstimateToInvoiceDto {
  @IsOptional()
  @IsDateString()
  due_date?: string;

  @IsString()
  @IsOptional()
  @MaxLength(500)
  payment_terms?: string;

  @IsString()
  @IsOptional()
  @MaxLength(5000)
  customer_notes?: string;

  @IsString()
  @IsOptional()
  @MaxLength(5000)
  private_notes?: string;
}
