import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';
import { Client } from '../../clients/schemas/client.schema';
import { OrgDocument } from '../../documents/schemas/document.schema';
import { Organization } from '../../organizations/schemas/organization.schema';
import { User } from '../../users/schemas/user.schema';
import {
  SourceMetadata,
  SourceMetadataSchema,
} from '../../common/schemas/source-metadata.schema';

export type PaymentDocument = HydratedDocument<Payment>;

export const PAYMENT_PROVIDER_VALUES = ['manual', 'stripe'] as const;
export type PaymentProvider = (typeof PAYMENT_PROVIDER_VALUES)[number];

export const PAYMENT_STATUS_VALUES = [
  'created',
  'checkout_open',
  'processing',
  'succeeded',
  'failed',
  'expired',
  'requires_action',
  'partially_refunded',
  'refunded',
  'disputed',
  'dispute_lost',
  'canceled',
] as const;
export type PaymentStatus = (typeof PAYMENT_STATUS_VALUES)[number];

export const PAYMENT_METHOD_VALUES = [
  'cash',
  'check',
  'other',
  'card',
  'ach',
] as const;
export type PaymentMethod = (typeof PAYMENT_METHOD_VALUES)[number];

export const PAYMENT_PURPOSE_VALUES = [
  'deposit',
  'invoice_balance',
  'other',
] as const;
export type PaymentPurpose = (typeof PAYMENT_PURPOSE_VALUES)[number];

@Schema({
  collection: 'payments',
  timestamps: {
    createdAt: 'created_at',
    updatedAt: 'updated_at',
  },
})
export class Payment {
  @Prop({
    type: Types.ObjectId,
    ref: Organization.name,
    required: true,
    index: true,
  })
  organization_id!: Types.ObjectId;

  @Prop({
    type: Types.ObjectId,
    ref: OrgDocument.name,
    required: true,
    index: true,
  })
  document_id!: Types.ObjectId;

  @Prop({
    type: Types.ObjectId,
    ref: Client.name,
    required: true,
    index: true,
  })
  client_id!: Types.ObjectId;

  @Prop({
    type: String,
    required: true,
    enum: PAYMENT_PROVIDER_VALUES,
    default: 'manual',
  })
  provider!: PaymentProvider;

  @Prop({
    type: Number,
    required: true,
    min: 0,
  })
  amount_minor!: number;

  @Prop({
    type: String,
    required: true,
    default: 'usd',
  })
  currency!: 'usd';

  @Prop({
    type: String,
    required: true,
    enum: PAYMENT_STATUS_VALUES,
    default: 'succeeded',
  })
  status!: PaymentStatus;

  @Prop({
    type: String,
    required: true,
    enum: PAYMENT_METHOD_VALUES,
    default: 'cash',
  })
  method!: PaymentMethod;

  @Prop({
    type: String,
    required: true,
    enum: PAYMENT_PURPOSE_VALUES,
    default: 'invoice_balance',
  })
  purpose!: PaymentPurpose;

  @Prop({
    type: String,
    trim: true,
    default: null,
  })
  reference!: string | null;

  @Prop({
    type: String,
    trim: true,
    default: null,
  })
  note!: string | null;

  @Prop({ type: String, trim: true, default: null })
  provider_customer_id!: string | null;

  @Prop({ type: String, trim: true, default: null, index: true })
  provider_checkout_id!: string | null;

  @Prop({ type: String, trim: true, default: null, index: true })
  provider_payment_intent_id!: string | null;

  @Prop({ type: String, trim: true, default: null })
  provider_payment_method_type!: string | null;

  @Prop({ type: String, trim: true, default: null })
  provider_charge_id!: string | null;

  @Prop({ type: String, trim: true, default: null })
  provider_account_id!: string | null;

  @Prop({ type: Boolean, required: true, default: false })
  provider_livemode!: boolean;

  @Prop({ type: String, trim: true, default: null })
  checkout_url!: string | null;

  @Prop({ type: String, trim: true, default: null })
  receipt_url!: string | null;

  @Prop({ type: Date, default: null })
  paid_at!: Date | null;

  @Prop({ type: Date, default: null })
  failed_at!: Date | null;

  @Prop({ type: String, trim: true, default: null })
  failure_message!: string | null;

  @Prop({ type: String, trim: true, default: null })
  operation_idempotency_key!: string | null;

  @Prop({ type: String, trim: true, default: null })
  checkout_lock_key!: string | null;

  @Prop({ type: SourceMetadataSchema, default: null })
  source_metadata!: SourceMetadata | null;

  @Prop({
    type: Date,
    required: true,
    default: Date.now,
  })
  effective_at!: Date;

  @Prop({
    type: Types.ObjectId,
    ref: User.name,
    default: null,
  })
  created_by_user_id!: Types.ObjectId | null;

  created_at!: Date;
  updated_at!: Date;
}

export const PaymentSchema = SchemaFactory.createForClass(Payment);

PaymentSchema.index({ organization_id: 1, document_id: 1 });
PaymentSchema.index({ organization_id: 1, client_id: 1 });
PaymentSchema.index({ organization_id: 1, effective_at: -1 });
PaymentSchema.index({
  organization_id: 1,
  provider: 1,
  provider_checkout_id: 1,
});
PaymentSchema.index({
  organization_id: 1,
  provider: 1,
  provider_payment_intent_id: 1,
});
PaymentSchema.index(
  { organization_id: 1, operation_idempotency_key: 1 },
  {
    unique: true,
    partialFilterExpression: { operation_idempotency_key: { $type: 'string' } },
  },
);
PaymentSchema.index(
  { organization_id: 1, checkout_lock_key: 1 },
  {
    unique: true,
    partialFilterExpression: { checkout_lock_key: { $type: 'string' } },
    name: 'uniq_active_stripe_checkout_per_invoice',
  },
);
PaymentSchema.index(
  {
    organization_id: 1,
    'source_metadata.source_system': 1,
    'source_metadata.source_entity': 1,
    'source_metadata.source_id': 1,
  },
  {
    unique: true,
    partialFilterExpression: {
      'source_metadata.source_id': { $type: 'string' },
    },
    name: 'uniq_payment_source_identity',
  },
);
