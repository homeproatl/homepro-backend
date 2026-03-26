import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type AuthRateLimitDocument = HydratedDocument<AuthRateLimit>;

@Schema({
  collection: 'auth_rate_limits',
  timestamps: false,
})
export class AuthRateLimit {
  @Prop({ required: true, unique: true, index: true })
  key!: string;

  @Prop({ required: true, default: 1 })
  count!: number;

  @Prop({
    required: true,
    index: { expireAfterSeconds: 0 },
  })
  reset_at!: Date;
}

export const AuthRateLimitSchema = SchemaFactory.createForClass(AuthRateLimit);
