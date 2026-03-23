import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';
import { Job } from './job.schema';

export type JobPartDocument = HydratedDocument<JobPart>;

@Schema({
  collection: 'job_parts',
  timestamps: {
    createdAt: 'created_at',
    updatedAt: 'updated_at',
  },
})
export class JobPart {
  @Prop({ type: Types.ObjectId, ref: Job.name, required: true, index: true })
  job_id!: Types.ObjectId;

  @Prop({ required: true, trim: true })
  part_name!: string;

  @Prop({ required: true, min: 0 })
  quantity!: number;

  @Prop({ type: Number, default: null })
  cost!: number | null;

  @Prop({ required: true, min: 0 })
  unit_price!: number;

  @Prop({ required: true, min: 0, default: 0 })
  sub_total!: number;
}

export const JobPartSchema = SchemaFactory.createForClass(JobPart);
