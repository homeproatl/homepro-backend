import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';
import { OrgDocument } from './document.schema';
import { Organization } from '../../organizations/schemas/organization.schema';

export type DocumentAutomationJobDocument =
  HydratedDocument<DocumentAutomationJob>;

export const AUTOMATION_JOB_TYPE_VALUES = ['convert_to_invoice'] as const;
export type AutomationJobType = (typeof AUTOMATION_JOB_TYPE_VALUES)[number];

export const AUTOMATION_JOB_STATUS_VALUES = [
  'pending',
  'processing',
  'completed',
  'failed',
] as const;
export type AutomationJobStatus = (typeof AUTOMATION_JOB_STATUS_VALUES)[number];

@Schema({
  collection: 'document_automation_jobs',
  timestamps: {
    createdAt: 'created_at',
    updatedAt: 'updated_at',
  },
})
export class DocumentAutomationJob {
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
  estimate_id!: Types.ObjectId;

  @Prop({
    type: Number,
    required: true,
  })
  frozen_version!: number;

  @Prop({
    type: String,
    required: true,
  })
  frozen_hash!: string;

  @Prop({
    type: String,
    required: true,
    enum: AUTOMATION_JOB_TYPE_VALUES,
    default: 'convert_to_invoice',
  })
  job_type!: AutomationJobType;

  @Prop({
    type: String,
    required: true,
    enum: AUTOMATION_JOB_STATUS_VALUES,
    default: 'pending',
    index: true,
  })
  status!: AutomationJobStatus;

  @Prop({
    type: Date,
    default: null,
  })
  lease_expires_at!: Date | null;

  @Prop({
    type: Number,
    required: true,
    default: 0,
  })
  attempts!: number;

  @Prop({
    type: Date,
    required: true,
    default: Date.now,
  })
  next_attempt_at!: Date;

  @Prop({
    type: String,
    default: null,
  })
  last_error!: string | null;

  created_at!: Date;
  updated_at!: Date;
}

export const DocumentAutomationJobSchema = SchemaFactory.createForClass(
  DocumentAutomationJob,
);

DocumentAutomationJobSchema.index(
  { organization_id: 1, estimate_id: 1, job_type: 1 },
  { unique: true },
);
DocumentAutomationJobSchema.index({ status: 1, next_attempt_at: 1 });
