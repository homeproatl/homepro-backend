import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';
import { Organization } from '../../organizations/schemas/organization.schema';

export type ContractTemplateDocument = HydratedDocument<ContractTemplate>;

export const CONTRACT_TEMPLATE_FIELD_LIMITS = {
  name: 160,
  body: 50_000,
} as const;

export const DEFAULT_CONTRACT_TEMPLATE_NAME = 'Default Contract';
export const DEFAULT_CONTRACT_TEMPLATE_BODY =
  'This agreement covers the work described in the attached estimate or invoice.';

@Schema({
  collection: 'contract_templates',
  timestamps: {
    createdAt: 'created_at',
    updatedAt: 'updated_at',
  },
})
export class ContractTemplate {
  @Prop({
    type: Types.ObjectId,
    ref: Organization.name,
    required: true,
    index: true,
  })
  organization_id!: Types.ObjectId;

  @Prop({
    required: true,
    trim: true,
    maxlength: CONTRACT_TEMPLATE_FIELD_LIMITS.name,
  })
  name!: string;

  @Prop({
    required: true,
    trim: true,
    maxlength: CONTRACT_TEMPLATE_FIELD_LIMITS.name,
  })
  normalized_name!: string;

  @Prop({
    type: String,
    required: true,
    default: '',
    maxlength: CONTRACT_TEMPLATE_FIELD_LIMITS.body,
  })
  body!: string;

  @Prop({ type: Boolean, default: false })
  is_default!: boolean;

  @Prop({ type: Boolean, default: true })
  is_active!: boolean;

  created_at!: Date;
  updated_at!: Date;
}

export const ContractTemplateSchema =
  SchemaFactory.createForClass(ContractTemplate);

ContractTemplateSchema.index(
  { organization_id: 1, normalized_name: 1 },
  { unique: true },
);
ContractTemplateSchema.index({ organization_id: 1, is_active: 1 });
