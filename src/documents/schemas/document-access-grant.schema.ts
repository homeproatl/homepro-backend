import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';
import { Organization } from '../../organizations/schemas/organization.schema';
import { OrgDocument } from './document.schema';
import { User } from '../../users/schemas/user.schema';

export type DocumentAccessGrantDocument = HydratedDocument<DocumentAccessGrant>;

export const DOCUMENT_GRANT_PERMISSION_VALUES = [
  'view',
  'download',
  'approve',
  'decline',
  'sign',
  'pay',
] as const;
export type DocumentGrantPermission =
  (typeof DOCUMENT_GRANT_PERMISSION_VALUES)[number];

@Schema({
  collection: 'document_access_grants',
  timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' },
})
export class DocumentAccessGrant {
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

  @Prop({ type: String, required: true })
  token_hash!: string;

  @Prop({
    type: [String],
    enum: DOCUMENT_GRANT_PERMISSION_VALUES,
    required: true,
  })
  permissions!: DocumentGrantPermission[];

  @Prop({ type: Date, default: null })
  expires_at!: Date | null;

  @Prop({ type: Date, default: null })
  revoked_at!: Date | null;

  @Prop({ type: Date, default: null })
  last_accessed_at!: Date | null;

  @Prop({
    type: Types.ObjectId,
    ref: User.name,
    required: true,
  })
  created_by_user_id!: Types.ObjectId;

  created_at!: Date;
  updated_at!: Date;
}

export const DocumentAccessGrantSchema =
  SchemaFactory.createForClass(DocumentAccessGrant);

DocumentAccessGrantSchema.index({ organization_id: 1, document_id: 1 });
DocumentAccessGrantSchema.index({ token_hash: 1 }, { unique: true });
/** At most one non-revoked grant per document. */
DocumentAccessGrantSchema.index(
  { organization_id: 1, document_id: 1 },
  {
    unique: true,
    partialFilterExpression: { revoked_at: null },
    name: 'uniq_active_grant_per_document',
  },
);
