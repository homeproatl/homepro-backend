import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';
import { Customer } from '../../customers/schemas/customer.schema';
import { Vehicle } from '../../vehicles/schemas/vehicle.schema';
import { User } from '../../users/schemas/user.schema';
import { PaidStatus } from '../../common/enums/paid-status.enum';
import { PaymentType } from '../../common/enums/payment-type.enum';
import { EstimateStatus } from '../../common/enums/estimate-status.enum';
import { EmbeddedTag, EmbeddedTagSchema } from '../../tags/schemas/tag.schema';

export type EstimateDocument = HydratedDocument<Estimate>;

@Schema({ _id: true, id: false })
export class EstimateLaborLine {
  _id?: Types.ObjectId;

  @Prop({ required: true, trim: true })
  description!: string;

  @Prop({ type: Types.ObjectId, ref: User.name, default: null })
  assigned_user_id!: Types.ObjectId | null;

  @Prop({ required: true, min: 0 })
  hours!: number;

  @Prop({ required: true, min: 0 })
  rate!: number;

  @Prop({ required: true, min: 0, max: 100, default: 0 })
  discount_percent!: number;

  @Prop({ required: true, default: false })
  is_completed!: boolean;

  @Prop({ required: true, min: 0, default: 0 })
  subtotal!: number;

  @Prop({ type: [EmbeddedTagSchema], default: [] })
  tags!: EmbeddedTag[];
}

export const EstimateLaborLineSchema =
  SchemaFactory.createForClass(EstimateLaborLine);

@Schema({ _id: true, id: false })
export class EstimatePartLine {
  _id?: Types.ObjectId;

  @Prop({ required: true, trim: true })
  name!: string;

  @Prop({ type: String, trim: true, default: null })
  part_number!: string | null;

  @Prop({ required: true, min: 1 })
  quantity!: number;

  @Prop({ type: Number, default: null, min: 0 })
  cost!: number | null;

  @Prop({ required: true, min: 0 })
  price!: number;

  @Prop({ required: true, min: 0, max: 100, default: 0 })
  discount_percent!: number;

  @Prop({ required: true, min: 0, default: 0 })
  subtotal!: number;

  @Prop({ type: [EmbeddedTagSchema], default: [] })
  tags!: EmbeddedTag[];
}

export const EstimatePartLineSchema =
  SchemaFactory.createForClass(EstimatePartLine);

@Schema({ _id: true, id: false })
export class EstimateServiceEntry {
  _id?: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'ServiceCatalog', default: null })
  canned_service_id!: Types.ObjectId | null;

  @Prop({ required: true, trim: true })
  name!: string;

  @Prop({ type: String, trim: true, default: null })
  note!: string | null;

  @Prop({
    type: [EstimateLaborLineSchema],
    default: [],
  })
  labor_lines!: EstimateLaborLine[];

  @Prop({
    type: [EstimatePartLineSchema],
    default: [],
  })
  part_lines!: EstimatePartLine[];

  @Prop({ required: true, min: 0, default: 0 })
  labor_total!: number;

  @Prop({ required: true, min: 0, default: 0 })
  parts_total!: number;

  @Prop({ required: true, min: 0, default: 0 })
  total!: number;
}

export const EstimateServiceEntrySchema =
  SchemaFactory.createForClass(EstimateServiceEntry);

@Schema({ _id: false, id: false })
export class EstimateSourceMetadata {
  @Prop({ required: true, trim: true, default: 'shopmonkey' })
  source_system!: string;

  @Prop({ type: String, trim: true, default: null })
  document_kind!: string | null;

  @Prop({ type: String, trim: true, default: null })
  external_order_id!: string | null;

  @Prop({ type: String, trim: true, default: null })
  external_reference_number!: string | null;

  @Prop({ type: String, trim: true, default: null })
  external_invoice_number!: string | null;

  @Prop({ type: String, trim: true, default: null })
  order_path!: string | null;

  @Prop({ type: String, trim: true, default: null })
  shop_timezone!: string | null;

  @Prop({ type: String, trim: true, default: null })
  source_state_label!: string | null;

  @Prop({ type: String, trim: true, default: null })
  invoice_status!: string | null;

  @Prop({ type: String, trim: true, default: null })
  appointment_status!: string | null;

  @Prop({ type: String, trim: true, default: null })
  created_at_shop_time!: string | null;

  @Prop({ type: String, trim: true, default: null })
  invoiced_at_shop_time!: string | null;
}

export const EstimateSourceMetadataSchema = SchemaFactory.createForClass(
  EstimateSourceMetadata,
);

@Schema({ _id: true, id: false })
export class EstimatePaymentEvent {
  _id?: Types.ObjectId;

  @Prop({ required: true, default: 0 })
  amount_delta!: number;

  @Prop({ required: true, min: 0, default: 0 })
  amount_paid_total!: number;

  @Prop({ required: true, min: 0, default: 0 })
  amount_remaining_total!: number;

  @Prop({
    type: String,
    required: true,
    enum: PaidStatus,
    default: PaidStatus.UNPAID,
  })
  payment_status!: PaidStatus;

  @Prop({ required: true, default: Date.now })
  recorded_at!: Date;

  @Prop({ type: String, trim: true, default: 'STATUS_UPDATE' })
  source!: string;

  @Prop({ type: Types.ObjectId, ref: User.name, default: null })
  actor_user_id!: Types.ObjectId | null;

  @Prop({ type: String, trim: true, default: null })
  note!: string | null;
}

export const EstimatePaymentEventSchema =
  SchemaFactory.createForClass(EstimatePaymentEvent);

@Schema({
  collection: 'estimates',
  timestamps: {
    createdAt: 'created_at',
    updatedAt: 'updated_at',
  },
})
export class Estimate {
  @Prop({ required: true, trim: true, uppercase: true, unique: true })
  estimate_number!: string;

  @Prop({ required: true, trim: true })
  title!: string;

  @Prop({
    type: Types.ObjectId,
    ref: Customer.name,
    required: true,
    index: true,
  })
  customer_id!: Types.ObjectId;

  @Prop({
    type: Types.ObjectId,
    ref: Vehicle.name,
    required: true,
    index: true,
  })
  vehicle_id!: Types.ObjectId;

  @Prop({ type: Date, default: null, index: true })
  scheduled_start!: Date | null;

  @Prop({ type: Date, default: null, index: true })
  scheduled_end!: Date | null;

  @Prop({ type: Types.ObjectId, ref: User.name, default: null, index: true })
  assigned_user_id!: Types.ObjectId | null;

  @Prop({ type: String, trim: true, default: null })
  complaint_or_request!: string | null;

  @Prop({ type: String, trim: true, default: null })
  notes!: string | null;

  @Prop({
    type: String,
    required: true,
    enum: EstimateStatus,
    default: EstimateStatus.SCHEDULED,
    index: true,
  })
  estimate_status!: EstimateStatus;

  @Prop({
    type: String,
    required: true,
    enum: PaidStatus,
    default: PaidStatus.UNPAID,
    index: true,
  })
  payment_status!: PaidStatus;

  @Prop({
    type: String,
    required: true,
    enum: PaymentType,
    default: PaymentType.POS_CARD,
  })
  payment_type!: PaymentType;

  @Prop({ type: Date, default: null, index: true })
  due_date!: Date | null;

  @Prop({
    type: [EstimateServiceEntrySchema],
    default: [],
  })
  services!: EstimateServiceEntry[];

  @Prop({ type: EstimateSourceMetadataSchema, default: null })
  source_metadata!: EstimateSourceMetadata | null;

  @Prop({ type: Number, required: true, default: 0, min: 0 })
  labor_total!: number;

  @Prop({ type: Number, required: true, default: 0, min: 0 })
  parts_total!: number;

  @Prop({ type: Number, required: true, default: 0, min: 0 })
  subtotal!: number;

  @Prop({ type: Number, required: true, default: 8.875, min: 0 })
  tax_rate!: number;

  @Prop({ type: Number, required: true, default: 0, min: 0 })
  tax_amount!: number;

  @Prop({ type: Number, required: true, default: 0 })
  total!: number;

  @Prop({ type: Number, required: true, default: 0, min: 0 })
  amount_paid!: number;

  @Prop({ type: [EstimatePaymentEventSchema], default: [] })
  payment_events!: EstimatePaymentEvent[];
}

export const EstimateSchema = SchemaFactory.createForClass(Estimate);

EstimateSchema.index({
  assigned_user_id: 1,
  scheduled_start: 1,
  scheduled_end: 1,
});
EstimateSchema.index({ created_at: -1 });
EstimateSchema.index({ 'source_metadata.external_order_id': 1 });
EstimateSchema.index({ 'source_metadata.external_invoice_number': 1 });
