import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';
import { Organization } from '../../organizations/schemas/organization.schema';

export type DocumentEventDocument = HydratedDocument<DocumentEvent>;

export const DOCUMENT_EVENT_ACTIONS = [
  'create',
  'update',
  'status',
  'status.changed',
  'send',
  'view',
  'approve',
  'decline',
  'sign',
  'convert',
  'void',
  'restore',
] as const;
export type DocumentEventAction = (typeof DOCUMENT_EVENT_ACTIONS)[number];

@Schema({
  collection: 'document_events',
  timestamps: false,
})
export class DocumentEvent {
  @Prop({
    type: Types.ObjectId,
    ref: Organization.name,
    required: true,
    index: true,
  })
  organization_id!: Types.ObjectId;

  @Prop({ type: Types.ObjectId, required: true, index: true })
  document_id!: Types.ObjectId;

  @Prop({ type: Types.ObjectId, default: null })
  actor_user_id!: Types.ObjectId | null;

  @Prop({ type: Types.ObjectId, default: null })
  public_grant_id!: Types.ObjectId | null;

  @Prop({ type: String, required: true })
  action!: string;

  @Prop({ type: String, default: null })
  old_status!: string | null;

  @Prop({ type: String, default: null })
  new_status!: string | null;

  @Prop({ type: Object, default: {} })
  metadata!: Record<string, unknown>;

  @Prop({ type: Date, required: true, default: () => new Date() })
  occurred_at!: Date;
}

export const DocumentEventSchema = SchemaFactory.createForClass(DocumentEvent);

DocumentEventSchema.index({
  organization_id: 1,
  document_id: 1,
  occurred_at: -1,
});
