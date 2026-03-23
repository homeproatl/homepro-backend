import { BadRequestException } from '@nestjs/common';
import { Types } from 'mongoose';

export function asObjectId(value: string, field = 'id'): Types.ObjectId {
  if (!Types.ObjectId.isValid(value)) {
    throw new BadRequestException(`Invalid ${field}`);
  }

  return new Types.ObjectId(value);
}
