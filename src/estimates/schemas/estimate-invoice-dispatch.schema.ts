import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';
import { Estimate } from './estimate.schema';
import { EstimateInvoiceSnapshot } from './estimate-invoice-snapshot.schema';
import { EstimateInvoiceDispatchStatus } from '../enums/estimate-invoice-dispatch-status.enum';

export type EstimateInvoiceDispatchDocument = HydratedDocument<EstimateInvoiceDispatch>;

@Schema({
  collection: 'estimate_invoice_dispatches',
  timestamps: {
    createdAt: 'created_at',
    updatedAt: 'updated_at',
  },
})
export class EstimateInvoiceDispatch {
  @Prop({
    type: Types.ObjectId,
    ref: Estimate.name,
    required: true,
    index: true,
  })
  estimate_id!: Types.ObjectId;

  @Prop({
    type: Types.ObjectId,
    ref: EstimateInvoiceSnapshot.name,
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

  @Prop({ type: String, default: null })
  provider_request_key!: string | null;

  @Prop({
    type: String,
    required: true,
    enum: EstimateInvoiceDispatchStatus,
    default: EstimateInvoiceDispatchStatus.PENDING,
    index: true,
  })
  delivery_status!: EstimateInvoiceDispatchStatus;

  @Prop({ type: String, default: null })
  error_message!: string | null;

  @Prop({ type: Date, default: null })
  sent_at!: Date | null;

  created_at!: Date;

  updated_at!: Date;
}

export const EstimateInvoiceDispatchSchema =
  SchemaFactory.createForClass(EstimateInvoiceDispatch);

EstimateInvoiceDispatchSchema.index({ estimate_id: 1, created_at: -1 });
EstimateInvoiceDispatchSchema.index({ invoice_snapshot_id: 1, created_at: -1 });
