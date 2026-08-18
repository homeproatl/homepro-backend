import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';
import { Organization } from '../../organizations/schemas/organization.schema';
import { OrgDocument } from './document.schema';

export type DocumentEmailOutboxDocument = HydratedDocument<DocumentEmailOutbox>;

export const EMAIL_OUTBOX_STATUS_VALUES = [
  'pending',
  'processing',
  'sent',
  'failed',
] as const;
export type EmailOutboxStatus = (typeof EMAIL_OUTBOX_STATUS_VALUES)[number];

@Schema({
  collection: 'document_email_outbox',
  timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' },
})
export class DocumentEmailOutbox {
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

  @Prop({ type: String, required: true, trim: true, lowercase: true })
  recipient_email!: string;

  @Prop({ type: String, required: true, trim: true })
  template_key!: string;

  /**
   * Sanitized email content snapshot without the public URL/token.
   * Worker injects the decrypted public URL at send time.
   */
  @Prop({ type: Object, required: true })
  email_snapshot!: {
    company_name: string;
    client_display_name: string;
    document_number: string;
    estimate_number?: string;
    total_minor: number;
    subject?: string | null;
    message?: string | null;
  };

  /** Unique send attempt key (document + version + recipient + purpose). */
  @Prop({ type: String, required: true })
  idempotency_key!: string;

  @Prop({
    type: String,
    enum: EMAIL_OUTBOX_STATUS_VALUES,
    required: true,
    default: 'pending',
  })
  status!: EmailOutboxStatus;

  @Prop({ type: Number, required: true, default: 0, min: 0 })
  attempt_count!: number;

  @Prop({ type: Date, default: null })
  lease_until!: Date | null;

  @Prop({ type: Date, default: null })
  next_attempt_at!: Date | null;

  @Prop({ type: String, default: null })
  provider_message_id!: string | null;

  @Prop({ type: String, default: null })
  last_error!: string | null;

  /**
   * Authenticated encryption of the plaintext public token/URL.
   * Erased after successful send. Never logged.
   */
  @Prop({ type: String, default: null })
  encrypted_public_payload!: string | null;

  /**
   * Authenticated encryption of PDF bytes (base64) for invoice attachment.
   * Erased after successful send.
   */
  @Prop({ type: String, default: null })
  encrypted_pdf_payload!: string | null;

  @Prop({ type: Date, default: null })
  sent_at!: Date | null;

  created_at!: Date;
  updated_at!: Date;
}

export const DocumentEmailOutboxSchema =
  SchemaFactory.createForClass(DocumentEmailOutbox);

DocumentEmailOutboxSchema.index({ status: 1, next_attempt_at: 1 });
DocumentEmailOutboxSchema.index({ idempotency_key: 1 }, { unique: true });
