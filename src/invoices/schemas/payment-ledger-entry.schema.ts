import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';
import { OrgDocument } from '../../documents/schemas/document.schema';
import { Organization } from '../../organizations/schemas/organization.schema';
import { User } from '../../users/schemas/user.schema';
import { Payment } from './payment.schema';

export type PaymentLedgerEntryDocument = HydratedDocument<PaymentLedgerEntry>;

export const LEDGER_ENTRY_TYPE_VALUES = [
  'payment',
  'refund',
  'dispute_hold',
  'dispute_reversal',
  'manual_adjustment',
] as const;
export type LedgerEntryType = (typeof LEDGER_ENTRY_TYPE_VALUES)[number];

@Schema({
  collection: 'payment_ledger_entries',
  timestamps: {
    createdAt: 'created_at',
    updatedAt: false,
  },
})
export class PaymentLedgerEntry {
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
    ref: Payment.name,
    required: true,
    index: true,
  })
  payment_id!: Types.ObjectId;

  @Prop({
    type: String,
    required: true,
    enum: LEDGER_ENTRY_TYPE_VALUES,
  })
  entry_type!: LedgerEntryType;

  @Prop({
    type: Number,
    required: true,
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
    default: null,
  })
  provider_object_id!: string | null;

  @Prop({
    type: String,
    required: true,
    trim: true,
  })
  idempotency_key!: string;

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
}

export const PaymentLedgerEntrySchema =
  SchemaFactory.createForClass(PaymentLedgerEntry);

PaymentLedgerEntrySchema.index(
  { organization_id: 1, idempotency_key: 1 },
  { unique: true },
);
PaymentLedgerEntrySchema.index({ organization_id: 1, document_id: 1 });
PaymentLedgerEntrySchema.index({ organization_id: 1, effective_at: -1 });
