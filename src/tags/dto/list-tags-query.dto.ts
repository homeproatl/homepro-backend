import { IsEnum } from 'class-validator';
import { TAG_SCOPE_VALUES, type TagScope } from '../tag-scopes';

export class ListTagsQueryDto {
  @IsEnum(TAG_SCOPE_VALUES)
  scope!: TagScope;
}
