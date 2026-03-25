import { Transform } from 'class-transformer';
import { IsOptional, IsString } from 'class-validator';

function normalizeSearchValue(value: unknown) {
  if (typeof value !== 'string') {
    return value;
  }

  const trimmedValue = value.trim();
  return trimmedValue.length > 0 ? trimmedValue : undefined;
}

export class ListCustomersQueryDto {
  @IsOptional()
  @Transform(({ value }) => normalizeSearchValue(value))
  @IsString()
  search?: string;
}
