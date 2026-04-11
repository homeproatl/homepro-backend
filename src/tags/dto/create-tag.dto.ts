import { Transform } from 'class-transformer';
import { IsEnum, IsString, MaxLength, MinLength } from 'class-validator';
import { TAG_COLOR_VALUES, type TagColor } from '../tag-colors';
import { TAG_SCOPE_VALUES, type TagScope } from '../tag-scopes';

export class CreateTagDto {
  @IsEnum(TAG_SCOPE_VALUES)
  scope!: TagScope;

  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @MinLength(1)
  @MaxLength(40)
  name!: string;

  @IsEnum(TAG_COLOR_VALUES)
  color!: TagColor;
}
