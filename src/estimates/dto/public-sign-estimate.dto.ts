import { IsString, MaxLength, MinLength } from 'class-validator';

export class PublicSignEstimateDto {
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  signer_name!: string;
}
