import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import {
  AuthRateLimit,
  AuthRateLimitDocument,
} from './schemas/auth-rate-limit.schema';

@Injectable()
export class AuthRateLimitService {
  constructor(
    @InjectModel(AuthRateLimit.name)
    private readonly authRateLimitModel: Model<AuthRateLimitDocument>,
  ) {}

  async consume(key: string, limit: number, windowMs: number) {
    const now = new Date();
    const nextWindowReset = new Date(now.getTime() + windowMs);

    const incrementedBucket = await this.authRateLimitModel
      .findOneAndUpdate(
        {
          key,
          reset_at: { $gt: now },
          count: { $lt: limit },
        },
        { $inc: { count: 1 } },
        { returnDocument: 'after' },
      )
      .exec();

    if (incrementedBucket) {
      return null;
    }

    const blockedBucket = await this.authRateLimitModel
      .findOne({
        key,
        reset_at: { $gt: now },
      })
      .exec();

    if (blockedBucket) {
      return Math.max(
        1,
        Math.ceil((blockedBucket.reset_at.getTime() - now.getTime()) / 1000),
      );
    }

    try {
      await this.authRateLimitModel
        .findOneAndUpdate(
          { key },
          {
            $set: {
              count: 1,
              reset_at: nextWindowReset,
            },
          },
          {
            returnDocument: 'after',
            upsert: true,
            setDefaultsOnInsert: true,
          },
        )
        .exec();

      return null;
    } catch (error) {
      if ((error as { code?: number }).code !== 11000) {
        throw error;
      }

      const retryBucket = await this.authRateLimitModel
        .findOne({
          key,
          reset_at: { $gt: now },
        })
        .exec();

      if (!retryBucket) {
        return null;
      }

      return Math.max(
        1,
        Math.ceil((retryBucket.reset_at.getTime() - now.getTime()) / 1000),
      );
    }
  }
}
