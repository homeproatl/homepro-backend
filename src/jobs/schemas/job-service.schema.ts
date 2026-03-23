import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';
import { ServiceCatalog } from '../../service-catalog/schemas/service-catalog.schema';
import { Job } from './job.schema';

export type JobServiceDocument = HydratedDocument<JobService>;

@Schema({
  collection: 'job_services',
  timestamps: {
    createdAt: 'created_at',
    updatedAt: 'updated_at',
  },
})
export class JobService {
  @Prop({ type: Types.ObjectId, ref: Job.name, required: true, index: true })
  job_id!: Types.ObjectId;

  @Prop({
    type: Types.ObjectId,
    ref: ServiceCatalog.name,
    required: true,
    index: true,
  })
  service_id!: Types.ObjectId;

  @Prop({ required: true, min: 1, default: 1 })
  quantity!: number;

  @Prop({ required: true, min: 0 })
  unit_price_snapshot!: number;

  @Prop({ required: true, min: 0, default: 0 })
  sub_total!: number;
}

export const JobServiceSchema = SchemaFactory.createForClass(JobService);

JobServiceSchema.index({ job_id: 1, service_id: 1 });
