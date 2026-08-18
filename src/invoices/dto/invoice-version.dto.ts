import { IsInt, Min } from 'class-validator';

export class InvoiceVersionDto {
  @IsInt()
  @Min(1)
  version!: number;
}
