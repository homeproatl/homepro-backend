import { Transform } from 'class-transformer';
import { IsInt, Min } from 'class-validator';

function transformInteger(value: unknown) {
  if (value === undefined || value === null || value === '') {
    return undefined;
  }
  if (typeof value === 'number' && Number.isSafeInteger(value)) {
    return value;
  }
  if (typeof value === 'string' && /^-?\d+$/.test(value.trim())) {
    return Number(value.trim());
  }
  return value;
}

export class ArchiveEstimateDocumentDto {
  @Transform(({ value }) => transformInteger(value))
  @IsInt()
  @Min(1)
  version!: number;
}
