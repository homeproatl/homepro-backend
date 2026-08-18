import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';
import { Address, AddressSchema } from '../../common/schemas/address.schema';
import { Client } from '../../clients/schemas/client.schema';
import { Organization } from '../../organizations/schemas/organization.schema';
import {
  SourceMetadata,
  SourceMetadataSchema,
} from '../../common/schemas/source-metadata.schema';
import {
  ITEM_TYPE_VALUES,
  MARKUP_TYPE_VALUES,
} from '../../items/schemas/item.schema';
import {
  ALL_DOCUMENT_STATUSES,
  DOCUMENT_TYPE_VALUES,
  type ArchivableFromStatus,
  type DocumentStatus,
  type DocumentType,
} from '../document-status';

export type OrgDocumentDocument = HydratedDocument<OrgDocument>;

export const PURCHASE_STATUS_VALUES = [
  'not_needed',
  'needed',
  'quoted',
  'ordered',
  'received',
  'installed',
] as const;
export type PurchaseStatus = (typeof PURCHASE_STATUS_VALUES)[number];

export const EMAIL_STATE_VALUES = [
  'not_sent',
  'sent',
  'opened',
  'delivery_failed',
] as const;
export type EmailState = (typeof EMAIL_STATE_VALUES)[number];

export const SYNC_STATE_VALUES = [
  'not_synced',
  'synced',
  'sync_error',
] as const;
export type SyncState = (typeof SYNC_STATE_VALUES)[number];

export const DOCUMENT_LINE_TYPE_VALUES = ITEM_TYPE_VALUES;
export type DocumentLineType = (typeof DOCUMENT_LINE_TYPE_VALUES)[number];

export const DOCUMENT_FIELD_LIMITS = {
  number: 40,
  po_number: 80,
  job_name: 200,
  description: 5000,
  notes: 5000,
  unit_of_measure: 40,
  sku_or_part_number: 120,
  vendor_name: 120,
  customer_notes: 10_000,
  private_notes: 10_000,
  contract_snapshot: 50_000,
  page_size_max: 100,
  search_token_max: 6,
  line_items_max: 200,
  rate_minor_max: 1_000_000_000,
  waste_basis_points_max: 100_000,
  markup_value_max: 1_000_000_000,
  quantity_milli_max: 1_000_000_000,
} as const;

@Schema({ _id: false, id: false })
export class ClientDocumentSnapshot {
  @Prop({ type: String, required: true, trim: true })
  display_name!: string;

  @Prop({ type: String, trim: true, default: null })
  company_name!: string | null;

  @Prop({ type: String, trim: true, default: null })
  email!: string | null;

  @Prop({ type: String, trim: true, default: null })
  phone!: string | null;

  @Prop({ type: AddressSchema, default: null })
  billing_address!: Address | null;

  @Prop({ type: AddressSchema, default: null })
  service_address!: Address | null;
}

export const ClientDocumentSnapshotSchema = SchemaFactory.createForClass(
  ClientDocumentSnapshot,
);

@Schema({ _id: false, id: false })
export class CompanyDocumentSnapshot {
  @Prop({ type: String, required: true, trim: true })
  display_name!: string;

  @Prop({ type: String, trim: true, default: null })
  legal_name!: string | null;

  @Prop({ type: String, trim: true, default: null })
  phone!: string | null;

  @Prop({ type: String, trim: true, default: null })
  email!: string | null;

  @Prop({ type: String, trim: true, default: null })
  website!: string | null;

  @Prop({ type: AddressSchema, default: null })
  address!: Address | null;

  @Prop({ type: String, trim: true, default: null })
  license_number!: string | null;

  @Prop({ type: Types.ObjectId, default: null })
  logo_asset_id!: Types.ObjectId | null;
}

export const CompanyDocumentSnapshotSchema = SchemaFactory.createForClass(
  CompanyDocumentSnapshot,
);

@Schema({ _id: false, id: false })
export class SettingsDocumentSnapshot {
  @Prop({ type: String, required: true, default: 'usd' })
  currency!: 'usd';

  @Prop({ type: String, required: true, default: 'en-US' })
  locale!: string;

  @Prop({ type: String, required: true, default: 'America/New_York' })
  timezone!: string;

  @Prop({ type: String, trim: true, default: null })
  payment_terms!: string | null;

  @Prop({ type: String, trim: true, default: null })
  footer!: string | null;
}

export const SettingsDocumentSnapshotSchema = SchemaFactory.createForClass(
  SettingsDocumentSnapshot,
);

@Schema({ _id: true, id: false })
export class DocumentLineItem {
  _id?: Types.ObjectId;

  @Prop({ type: Types.ObjectId, default: null })
  item_id!: Types.ObjectId | null;

  @Prop({ type: Number, required: true, min: 0, default: 0 })
  sort_order!: number;

  @Prop({
    type: String,
    required: true,
    enum: DOCUMENT_LINE_TYPE_VALUES,
    default: 'service',
  })
  line_type!: DocumentLineType;

  @Prop({
    type: String,
    required: true,
    trim: true,
    maxlength: DOCUMENT_FIELD_LIMITS.description,
  })
  description!: string;

  @Prop({
    type: String,
    trim: true,
    default: null,
    maxlength: DOCUMENT_FIELD_LIMITS.notes,
  })
  notes!: string | null;

  @Prop({
    type: String,
    trim: true,
    default: null,
    maxlength: DOCUMENT_FIELD_LIMITS.unit_of_measure,
  })
  unit_of_measure!: string | null;

  @Prop({
    type: String,
    trim: true,
    default: null,
    maxlength: DOCUMENT_FIELD_LIMITS.sku_or_part_number,
  })
  sku_or_part_number!: string | null;

  @Prop({
    type: String,
    trim: true,
    default: null,
    maxlength: DOCUMENT_FIELD_LIMITS.vendor_name,
  })
  vendor_name!: string | null;

  @Prop({
    type: String,
    required: true,
    enum: PURCHASE_STATUS_VALUES,
    default: 'not_needed',
  })
  purchase_status!: PurchaseStatus;

  @Prop({ type: Number, default: null, min: 0 })
  internal_unit_cost_minor!: number | null;

  @Prop({ type: Number, required: true, min: 0, default: 0 })
  waste_basis_points!: number;

  @Prop({ type: Number, required: true, min: 0, default: 0 })
  rate_minor!: number;

  @Prop({ type: Number, required: true, min: 1, default: 1000 })
  quantity_milli!: number;

  @Prop({ type: Number, required: true, min: 0, default: 0 })
  adjusted_quantity_milli!: number;

  @Prop({ type: Number, required: true, min: 0, default: 0 })
  internal_cost_total_minor!: number;

  @Prop({
    type: String,
    required: true,
    enum: MARKUP_TYPE_VALUES,
    default: 'none',
  })
  markup_type!: (typeof MARKUP_TYPE_VALUES)[number];

  @Prop({ type: Number, required: true, min: 0, default: 0 })
  markup_value!: number;

  @Prop({ type: Number, required: true, min: 0, default: 0 })
  markup_amount_minor!: number;

  @Prop({
    type: String,
    required: true,
    enum: MARKUP_TYPE_VALUES,
    default: 'none',
  })
  discount_type!: (typeof MARKUP_TYPE_VALUES)[number];

  @Prop({ type: Number, required: true, min: 0, default: 0 })
  discount_value!: number;

  @Prop({ type: Number, required: true, min: 0, default: 0 })
  discount_amount_minor!: number;

  @Prop({ type: Boolean, required: true, default: true })
  taxable!: boolean;

  @Prop({ type: Types.ObjectId, default: null })
  tax_id!: Types.ObjectId | null;

  @Prop({ type: [Types.ObjectId], default: [] })
  tax_ids!: Types.ObjectId[];

  @Prop({ type: Number, required: true, min: 0, default: 0 })
  tax_rate_basis_points!: number;

  @Prop({ type: Number, required: true, min: 0, default: 0 })
  tax_amount_minor!: number;

  @Prop({ type: Number, required: true, min: 0, default: 0 })
  subtotal_minor!: number;

  @Prop({ type: Number, required: true, min: 0, default: 0 })
  total_minor!: number;

  @Prop({ type: [Types.ObjectId], default: [] })
  photo_asset_ids!: Types.ObjectId[];

  @Prop({ type: String, trim: true, default: null, maxlength: 500 })
  tax_name_snapshot?: string | null;

  @Prop({ type: String, trim: true, default: null, maxlength: 500 })
  source_line_id?: string | null;
}

export const DocumentLineItemSchema =
  SchemaFactory.createForClass(DocumentLineItem);

@Schema({ _id: true, id: false })
export class DocumentPaymentScheduleEntry {
  _id?: Types.ObjectId;

  @Prop({ type: Number, required: true, min: 0 })
  sort_order!: number;

  @Prop({ type: String, required: true, trim: true, maxlength: 160 })
  label!: string;

  @Prop({ type: String, required: true, enum: ['percent', 'fixed'] })
  value_type!: 'percent' | 'fixed';

  @Prop({ type: Number, required: true, min: 0 })
  value!: number;

  @Prop({ type: Number, required: true, min: 0 })
  amount_minor!: number;

  @Prop({ type: Date, default: null })
  due_date!: Date | null;

  @Prop({ type: String, trim: true, default: null, maxlength: 80 })
  status!: string | null;
}

export const DocumentPaymentScheduleEntrySchema = SchemaFactory.createForClass(
  DocumentPaymentScheduleEntry,
);

@Schema({ _id: false, id: false })
export class DocumentTaxBreakdownSnapshot {
  @Prop({ type: String, required: true, trim: true, maxlength: 160 })
  name!: string;

  @Prop({ type: Number, required: true, default: 0 })
  amount_minor!: number;

  @Prop({ type: String, trim: true, default: null, maxlength: 80 })
  source_decimal!: string | null;
}

export const DocumentTaxBreakdownSnapshotSchema = SchemaFactory.createForClass(
  DocumentTaxBreakdownSnapshot,
);

/**
 * Shared estimate/invoice aggregate. Named OrgDocument to avoid clashing with
 * mongoose's Document type and the DOM Document global.
 */
@Schema({
  collection: 'documents',
  timestamps: {
    createdAt: 'created_at',
    updatedAt: 'updated_at',
  },
})
export class OrgDocument {
  @Prop({
    type: Types.ObjectId,
    ref: Organization.name,
    required: true,
    index: true,
  })
  organization_id!: Types.ObjectId;

  @Prop({
    type: String,
    required: true,
    enum: DOCUMENT_TYPE_VALUES,
  })
  type!: DocumentType;

  @Prop({
    type: String,
    required: true,
    trim: true,
    maxlength: DOCUMENT_FIELD_LIMITS.number,
  })
  number!: string;

  @Prop({
    type: String,
    trim: true,
    default: null,
    maxlength: DOCUMENT_FIELD_LIMITS.po_number,
  })
  po_number!: string | null;

  @Prop({
    type: Types.ObjectId,
    ref: Client.name,
    required: true,
  })
  client_id!: Types.ObjectId;

  @Prop({ type: Types.ObjectId, default: null })
  project_id!: Types.ObjectId | null;

  @Prop({
    type: String,
    trim: true,
    default: null,
    maxlength: DOCUMENT_FIELD_LIMITS.job_name,
  })
  job_name!: string | null;

  @Prop({ type: AddressSchema, default: null })
  service_address_snapshot!: Address | null;

  @Prop({ type: Date, default: null })
  issue_date!: Date | null;

  @Prop({ type: Date, default: null })
  expiration_date!: Date | null;

  @Prop({ type: Date, default: null })
  due_date!: Date | null;

  @Prop({
    type: String,
    required: true,
    enum: ALL_DOCUMENT_STATUSES,
    default: 'draft',
  })
  status!: DocumentStatus;

  @Prop({
    type: String,
    default: null,
  })
  archived_from_status!: ArchivableFromStatus | null;

  @Prop({ type: Types.ObjectId, default: null })
  source_estimate_id!: Types.ObjectId | null;

  @Prop({ type: ClientDocumentSnapshotSchema, required: true })
  client_snapshot!: ClientDocumentSnapshot;

  @Prop({ type: CompanyDocumentSnapshotSchema, required: true })
  company_snapshot!: CompanyDocumentSnapshot;

  @Prop({ type: SettingsDocumentSnapshotSchema, required: true })
  settings_snapshot!: SettingsDocumentSnapshot;

  @Prop({ type: [DocumentLineItemSchema], default: [] })
  line_items!: DocumentLineItem[];

  @Prop({ type: Number, required: true, min: 0, default: 0 })
  subtotal_minor!: number;

  @Prop({ type: Number, required: true, min: 0, default: 0 })
  markup_total_minor!: number;

  @Prop({ type: Number, required: true, min: 0, default: 0 })
  discount_total_minor!: number;

  @Prop({
    type: String,
    required: true,
    enum: ['none', 'percent', 'fixed'],
    default: 'none',
  })
  document_discount_type!: 'none' | 'percent' | 'fixed';

  @Prop({ type: Number, required: true, min: 0, default: 0 })
  document_discount_value!: number;

  @Prop({ type: Number, required: true, min: 0, default: 0 })
  tax_total_minor!: number;

  @Prop({ type: Number, required: true, min: 0, default: 0 })
  deposit_requested_minor!: number;

  @Prop({ type: Number, required: true, min: 0, default: 0 })
  total_minor!: number;

  @Prop({ type: [DocumentPaymentScheduleEntrySchema], default: [] })
  payment_schedule!: DocumentPaymentScheduleEntry[];

  @Prop({ type: SourceMetadataSchema, default: null })
  source_metadata!: SourceMetadata | null;

  @Prop({
    type: String,
    required: true,
    enum: ['native', 'imported_summary', 'fully_imported'],
    default: 'native',
  })
  migration_state!: 'native' | 'imported_summary' | 'fully_imported';

  @Prop({ type: [DocumentTaxBreakdownSnapshotSchema], default: [] })
  tax_breakdown_snapshot!: DocumentTaxBreakdownSnapshot[];

  @Prop({ type: String, trim: true, default: null, maxlength: 80 })
  source_subtotal_decimal!: string | null;

  @Prop({ type: String, trim: true, default: null, maxlength: 80 })
  source_total_decimal!: string | null;

  @Prop({ type: String, trim: true, default: null, maxlength: 80 })
  source_payment_received_decimal!: string | null;

  @Prop({ type: Number, required: true, default: 0 })
  source_unexplained_adjustment_minor!: number;

  @Prop({ type: String, trim: true, default: null, maxlength: 128 })
  source_status!: string | null;

  @Prop({ type: String, trim: true, default: null, maxlength: 128 })
  source_account_id!: string | null;

  @Prop({ type: Number, required: true, min: 0, default: 0 })
  amount_paid_minor!: number;

  @Prop({ type: Number, required: true, min: 0, default: 0 })
  amount_refunded_minor!: number;

  @Prop({ type: Number, required: true, min: 0, default: 0 })
  amount_disputed_minor!: number;

  @Prop({ type: Number, required: true, min: 0, default: 0 })
  balance_due_minor!: number;

  @Prop({
    type: String,
    required: true,
    enum: EMAIL_STATE_VALUES,
    default: 'not_sent',
  })
  email_state!: EmailState;

  @Prop({
    type: String,
    required: true,
    enum: SYNC_STATE_VALUES,
    default: 'not_synced',
  })
  sync_state!: SyncState;

  @Prop({ type: Boolean, required: true, default: false })
  online_payments_enabled!: boolean;

  @Prop({ type: Boolean, required: true, default: false })
  auto_generate_invoice_enabled!: boolean;

  @Prop({ type: Types.ObjectId, default: null })
  contract_template_id!: Types.ObjectId | null;

  @Prop({
    type: String,
    default: null,
    maxlength: DOCUMENT_FIELD_LIMITS.contract_snapshot,
  })
  contract_snapshot!: string | null;

  @Prop({ type: Boolean, required: true, default: false })
  show_client_signature!: boolean;

  @Prop({ type: Boolean, required: true, default: false })
  show_company_signature!: boolean;

  @Prop({
    type: String,
    trim: true,
    default: null,
    maxlength: DOCUMENT_FIELD_LIMITS.customer_notes,
  })
  customer_notes!: string | null;

  @Prop({
    type: String,
    trim: true,
    default: null,
    maxlength: DOCUMENT_FIELD_LIMITS.private_notes,
  })
  private_notes!: string | null;

  @Prop({ type: [Types.ObjectId], default: [] })
  document_photo_asset_ids!: Types.ObjectId[];

  @Prop({ type: [Types.ObjectId], default: [] })
  attachment_asset_ids!: Types.ObjectId[];

  @Prop({
    type: [{ asset_id: Types.ObjectId, caption: String, sort_order: Number }],
    default: [],
  })
  document_photo_metadata!: Array<{
    asset_id: Types.ObjectId;
    caption?: string | null;
    sort_order?: number;
  }>;

  @Prop({
    type: [{ asset_id: Types.ObjectId, filename: String, sort_order: Number }],
    default: [],
  })
  attachment_metadata!: Array<{
    asset_id: Types.ObjectId;
    filename?: string | null;
    sort_order?: number;
  }>;

  @Prop({ type: Number, required: true, min: 1, default: 1 })
  version!: number;

  @Prop({ type: Number, default: null, min: 1 })
  frozen_revision_number!: number | null;

  @Prop({ type: String, default: null })
  frozen_hash!: string | null;

  created_at!: Date;
  updated_at!: Date;
}

export const OrgDocumentSchema = SchemaFactory.createForClass(OrgDocument);

OrgDocumentSchema.index(
  { organization_id: 1, type: 1, number: 1 },
  { unique: true },
);
OrgDocumentSchema.index(
  {
    organization_id: 1,
    'source_metadata.source_system': 1,
    'source_metadata.source_entity': 1,
    'source_metadata.source_id': 1,
  },
  {
    unique: true,
    partialFilterExpression: {
      'source_metadata.source_id': { $type: 'string' },
    },
    name: 'uniq_document_source_identity',
  },
);
OrgDocumentSchema.index({ organization_id: 1, client_id: 1, status: 1 });
OrgDocumentSchema.index({
  organization_id: 1,
  type: 1,
  status: 1,
  updated_at: -1,
});
OrgDocumentSchema.index({
  organization_id: 1,
  type: 1,
  issue_date: -1,
  _id: -1,
});
OrgDocumentSchema.index({ organization_id: 1, type: 1, total_minor: 1 });
OrgDocumentSchema.index({ organization_id: 1, type: 1, email_state: 1 });
OrgDocumentSchema.index({ organization_id: 1, issue_date: 1 });
OrgDocumentSchema.index({ organization_id: 1, due_date: 1 });
OrgDocumentSchema.index({
  organization_id: 1,
  type: 1,
  'client_snapshot.display_name': 1,
});
OrgDocumentSchema.index({ organization_id: 1, type: 1, po_number: 1 });
OrgDocumentSchema.index({ organization_id: 1, type: 1, job_name: 1 });
/** One invoice per source estimate (idempotent conversion). */
OrgDocumentSchema.index(
  { organization_id: 1, source_estimate_id: 1 },
  {
    unique: true,
    partialFilterExpression: {
      type: 'invoice',
      source_estimate_id: { $type: 'objectId' },
    },
    name: 'uniq_invoice_source_estimate',
  },
);

/** Alias matching the domain name used in APIs and docs. */
export { OrgDocument as Document };
export type DocumentDocument = OrgDocumentDocument;
export const DocumentSchema = OrgDocumentSchema;
