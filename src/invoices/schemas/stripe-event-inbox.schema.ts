import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema } from 'mongoose';

export type StripeEventInboxDocument = HydratedDocument<StripeEventInbox>;

export const STRIPE_EVENT_PROCESSING_STATUS_VALUES = [
  'received',
  'processing',
  'processed',
  'ignored',
  'failed',
] as const;

export type StripeEventProcessingStatus =
  (typeof STRIPE_EVENT_PROCESSING_STATUS_VALUES)[number];

@Schema({
  collection: 'stripe_event_inbox',
  timestamps: {
    createdAt: 'created_at',
    updatedAt: 'updated_at',
  },
})
export class StripeEventInbox {
  @Prop({ type: String, required: true, trim: true, unique: true })
  stripe_event_id!: string;

  @Prop({ type: String, required: true, trim: true, index: true })
  event_type!: string;

  @Prop({ type: Boolean, required: true, default: false })
  livemode!: boolean;

  @Prop({ type: String, trim: true, default: null, index: true })
  stripe_account_id!: string | null;

  @Prop({
    type: String,
    required: true,
    enum: STRIPE_EVENT_PROCESSING_STATUS_VALUES,
    default: 'received',
  })
  processing_status!: StripeEventProcessingStatus;

  @Prop({ type: Date, default: null })
  processed_at!: Date | null;

  @Prop({ type: Date, default: null })
  processing_started_at!: Date | null;

  @Prop({ type: String, trim: true, default: null })
  last_error!: string | null;

  @Prop({ type: MongooseSchema.Types.Mixed, required: true })
  payload!: Record<string, unknown>;

  created_at!: Date;
  updated_at!: Date;
}

export const StripeEventInboxSchema =
  SchemaFactory.createForClass(StripeEventInbox);

StripeEventInboxSchema.index({ event_type: 1, created_at: -1 });
