import { IsOptional, IsString, MaxLength } from 'class-validator';

export class CreatePublicGrantDto {
  @IsOptional()
  @IsString()
  @MaxLength(40)
  expires_at?: string | null;
}
