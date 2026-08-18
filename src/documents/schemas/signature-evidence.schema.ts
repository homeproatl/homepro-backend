import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';
import { Organization } from '../../organizations/schemas/organization.schema';
import { OrgDocument } from './document.schema';
import { DocumentAccessGrant } from './document-access-grant.schema';

export type SignatureEvidenceDocument = HydratedDocument<SignatureEvidence>;

@Schema({
  collection: 'signature_evidence',
  timestamps: { createdAt: 'created_at', updatedAt: false },
})
export class SignatureEvidence {
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
  document_id!: Types.ObjectId;

  @Prop({ type: Number, required: true, min: 1 })
  document_version!: number;

  @Prop({ type: String, required: true })
  document_hash!: string;

  @Prop({
    type: Types.ObjectId,
    ref: DocumentAccessGrant.name,
    required: true,
  })
  access_grant_id!: Types.ObjectId;

  @Prop({ type: String, required: true, trim: true, maxlength: 200 })
  signer_name!: string;

  /** Drawn signature asset reserved for Step 15. Always null in Step 10. */
  @Prop({ type: Types.ObjectId, default: null })
  signature_asset_id!: Types.ObjectId | null;

  @Prop({ type: Date, required: true })
  signed_at!: Date;

  @Prop({ type: String, default: null })
  ip_address!: string | null;

  @Prop({ type: String, default: null })
  user_agent!: string | null;

  created_at!: Date;
}

export const SignatureEvidenceSchema =
  SchemaFactory.createForClass(SignatureEvidence);

SignatureEvidenceSchema.index(
  {
    organization_id: 1,
    document_id: 1,
    document_version: 1,
    access_grant_id: 1,
  },
  { unique: true },
);
