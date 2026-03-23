import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, SchemaTypes, Types } from 'mongoose';
import { PaidStatus } from '../../common/enums/paid-status.enum';
import { PaymentType } from '../../common/enums/payment-type.enum';
import { Job } from './job.schema';
import { JobInvoiceSnapshotStatus } from '../enums/job-invoice-snapshot-status.enum';

export type JobInvoiceSnapshotDocument = HydratedDocument<JobInvoiceSnapshot>;

@Schema({
  collection: 'job_invoice_snapshots',
  timestamps: {
    createdAt: 'created_at',
    updatedAt: 'updated_at',
  },
})
export class JobInvoiceSnapshot {
  @Prop({
    type: Types.ObjectId,
    ref: Job.name,
    required: true,
    index: true,
  })
  job_id!: Types.ObjectId;

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
    enum: JobInvoiceSnapshotStatus,
    default: JobInvoiceSnapshotStatus.ISSUED,
    index: true,
  })
  status!: JobInvoiceSnapshotStatus;

  @Prop({ type: SchemaTypes.Mixed, required: true })
  customer_snapshot!: Record<string, unknown>;

  @Prop({ type: SchemaTypes.Mixed, required: true })
  vehicle_snapshot!: Record<string, unknown>;

  @Prop({ type: [SchemaTypes.Mixed], required: true, default: [] })
  services_snapshot!: Record<string, unknown>[];

  @Prop({ type: [SchemaTypes.Mixed], required: true, default: [] })
  parts_snapshot!: Record<string, unknown>[];

  @Prop({ required: true, trim: true })
  job_number_snapshot!: string;

  @Prop({ required: true, trim: true })
  title_snapshot!: string;

  @Prop({ required: true, trim: true })
  time_zone_snapshot!: string;

  @Prop({ required: true })
  total!: number;

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
    ref: 'JobInvoiceSnapshot',
    default: null,
  })
  superseded_by_snapshot_id!: Types.ObjectId | null;

  created_at!: Date;

  updated_at!: Date;
}

export const JobInvoiceSnapshotSchema =
  SchemaFactory.createForClass(JobInvoiceSnapshot);

JobInvoiceSnapshotSchema.index(
  { job_id: 1, revision_number: -1 },
  { unique: true },
);
JobInvoiceSnapshotSchema.index({ job_id: 1, created_at: -1 });
