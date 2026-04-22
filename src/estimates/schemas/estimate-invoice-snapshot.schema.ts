import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, SchemaTypes, Types } from 'mongoose';
import { PaidStatus } from '../../common/enums/paid-status.enum';
import { PaymentType } from '../../common/enums/payment-type.enum';
import { Estimate } from './estimate.schema';
import { EstimateInvoiceSnapshotStatus } from '../enums/estimate-invoice-snapshot-status.enum';

export type EstimateInvoiceSnapshotDocument = HydratedDocument<EstimateInvoiceSnapshot>;

@Schema({
  collection: 'estimate_invoice_snapshots',
  timestamps: {
    createdAt: 'created_at',
    updatedAt: 'updated_at',
  },
})
export class EstimateInvoiceSnapshot {
  @Prop({
    type: Types.ObjectId,
    ref: Estimate.name,
    required: true,
    index: true,
  })
  estimate_id!: Types.ObjectId;

  @Prop({
    required: true,
    trim: true,
    uppercase: true,
    unique: true,
    index: true,
  })
  invoice_number!: string;

  @Prop({ required: true, min: 1 })
  revision_number!: number;

  @Prop({
    type: String,
    required: true,
    enum: EstimateInvoiceSnapshotStatus,
    default: EstimateInvoiceSnapshotStatus.ISSUED,
    index: true,
  })
  status!: EstimateInvoiceSnapshotStatus;

  @Prop({ type: SchemaTypes.Mixed, required: true })
  customer_snapshot!: Record<string, unknown>;

  @Prop({ type: SchemaTypes.Mixed, required: true })
  vehicle_snapshot!: Record<string, unknown>;

  @Prop({ type: [SchemaTypes.Mixed], required: true, default: [] })
  services_snapshot!: Record<string, unknown>[];

  @Prop({ required: true, trim: true })
  estimate_number_snapshot!: string;

  @Prop({ required: true, trim: true })
  title_snapshot!: string;

  @Prop({ required: true, trim: true })
  time_zone_snapshot!: string;

  @Prop({ type: String, default: null })
  complaint_or_request_snapshot!: string | null;

  @Prop({ type: String, default: null })
  recommendation_snapshot!: string | null;

  @Prop({ required: true, min: 0, default: 0 })
  subtotal_snapshot!: number;

  @Prop({ required: true, min: 0, default: 8.875 })
  tax_rate_snapshot!: number;

  @Prop({ required: true, min: 0, default: 0 })
  tax_amount_snapshot!: number;

  @Prop({ required: true })
  total!: number;

  @Prop({ required: true, min: 0, default: 0 })
  amount_paid_snapshot!: number;

  @Prop({ required: true, min: 0, default: 0 })
  amount_remaining_snapshot!: number;

  @Prop({
    type: String,
    required: true,
    enum: PaidStatus,
  })
  payment_status_snapshot!: PaidStatus;

  @Prop({
    type: String,
    required: true,
    enum: PaymentType,
  })
  payment_type_snapshot!: PaymentType;

  @Prop({ type: Date, default: null })
  due_date_snapshot!: Date | null;

  @Prop({ type: Date, default: null })
  scheduled_start_snapshot!: Date | null;

  @Prop({ type: Date, default: null })
  scheduled_end_snapshot!: Date | null;

  @Prop({ required: true })
  billable_hash!: string;

  @Prop({ type: Date, required: true, default: () => new Date(), index: true })
  issued_at!: Date;

  @Prop({ type: Date, default: null })
  sent_at!: Date | null;

  @Prop({ type: Date, default: null })
  stale_at!: Date | null;

  @Prop({
    type: Types.ObjectId,
    ref: 'EstimateInvoiceSnapshot',
    default: null,
  })
  superseded_by_snapshot_id!: Types.ObjectId | null;

  created_at!: Date;

  updated_at!: Date;
}

export const EstimateInvoiceSnapshotSchema =
  SchemaFactory.createForClass(EstimateInvoiceSnapshot);

EstimateInvoiceSnapshotSchema.index(
  { estimate_id: 1, revision_number: -1 },
  { unique: true },
);
EstimateInvoiceSnapshotSchema.index({ estimate_id: 1, created_at: -1 });
