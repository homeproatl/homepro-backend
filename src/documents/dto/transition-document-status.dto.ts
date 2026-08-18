import { Transform } from 'class-transformer';
import { IsEnum, IsInt, Min } from 'class-validator';
import { ALL_DOCUMENT_STATUSES, type DocumentStatus } from '../document-status';

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

export class TransitionDocumentStatusDto {
  @IsEnum(ALL_DOCUMENT_STATUSES)
  status!: DocumentStatus;

  @Transform(({ value }) => transformInteger(value))
  @IsInt()
  @Min(1)
  version!: number;
}

export class RestoreDocumentDto {
  @Transform(({ value }) => transformInteger(value))
  @IsInt()
  @Min(1)
  version!: number;
}
