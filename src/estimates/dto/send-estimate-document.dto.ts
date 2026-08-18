import { IsEmail, IsOptional, IsString, MaxLength } from 'class-validator';

export class SendEstimateDocumentDto {
  @IsEmail()
  recipient_email!: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  subject?: string;

  @IsOptional()
  @IsString()
  @MaxLength(5000)
  message?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  idempotency_key?: string;
}
