import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';
import { Customer } from '../../customers/schemas/customer.schema';
import { Vehicle } from '../../vehicles/schemas/vehicle.schema';
import { User } from '../../users/schemas/user.schema';
import { PaidStatus } from '../../common/enums/paid-status.enum';
import { PaymentType } from '../../common/enums/payment-type.enum';
import { JobStatus } from '../../common/enums/job-status.enum';

export type JobDocument = HydratedDocument<Job>;

@Schema({
  collection: 'jobs',
  timestamps: {
    createdAt: 'created_at',
    updatedAt: 'updated_at',
  },
})
export class Job {
  @Prop({ required: true, trim: true, uppercase: true, unique: true })
  job_number!: string;

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
    enum: JobStatus,
    default: JobStatus.SCHEDULED,
    index: true,
  })
  job_status!: JobStatus;

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

  @Prop({ type: Number, required: true, default: 0 })
  total!: number;
}

export const JobSchema = SchemaFactory.createForClass(Job);

JobSchema.index({ assigned_user_id: 1, scheduled_start: 1, scheduled_end: 1 });
JobSchema.index({ created_at: -1 });
