import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';
import { Job } from './job.schema';
import { JobInvoiceSnapshot } from './job-invoice-snapshot.schema';
import { JobInvoiceDispatchStatus } from '../enums/job-invoice-dispatch-status.enum';

export type JobInvoiceDispatchDocument = HydratedDocument<JobInvoiceDispatch>;

@Schema({
  collection: 'job_invoice_dispatches',
  timestamps: {
    createdAt: 'created_at',
    updatedAt: 'updated_at',
  },
})
export class JobInvoiceDispatch {
  @Prop({
    type: Types.ObjectId,
    ref: Job.name,
    required: true,
    index: true,
  })
  job_id!: Types.ObjectId;

  @Prop({
    type: Types.ObjectId,
    ref: JobInvoiceSnapshot.name,
    required: true,
    index: true,
  })
  invoice_snapshot_id!: Types.ObjectId;

  @Prop({ required: true, trim: true, lowercase: true })
  recipient_email!: string;

  @Prop({ required: true, trim: true })
  provider!: string;

  @Prop({ type: String, default: null })
  provider_message_id!: string | null;

  @Prop({
    type: String,
    required: true,
    enum: JobInvoiceDispatchStatus,
    default: JobInvoiceDispatchStatus.PENDING,
    index: true,
  })
  delivery_status!: JobInvoiceDispatchStatus;

  @Prop({ type: String, default: null })
  error_message!: string | null;

  @Prop({ type: Date, default: null })
  sent_at!: Date | null;

  created_at!: Date;

  updated_at!: Date;
}

export const JobInvoiceDispatchSchema =
  SchemaFactory.createForClass(JobInvoiceDispatch);

JobInvoiceDispatchSchema.index({ job_id: 1, created_at: -1 });
JobInvoiceDispatchSchema.index({ invoice_snapshot_id: 1, created_at: -1 });
