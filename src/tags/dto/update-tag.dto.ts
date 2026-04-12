import { Transform } from 'class-transformer';
import { IsEnum, IsString, MaxLength, MinLength } from 'class-validator';
import { TAG_COLOR_VALUES, type TagColor } from '../tag-colors';

export class UpdateTagDto {
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @MinLength(1)
  @MaxLength(40)
  name!: string;

  @IsEnum(TAG_COLOR_VALUES)
  color!: TagColor;
}
