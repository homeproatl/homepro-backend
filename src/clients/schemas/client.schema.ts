import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';
import { Address, AddressSchema } from '../../common/schemas/address.schema';
import {
  SourceMetadata,
  SourceMetadataSchema,
} from '../../common/schemas/source-metadata.schema';
import { Organization } from '../../organizations/schemas/organization.schema';

export type ClientDocument = HydratedDocument<Client>;

export const CLIENT_FIELD_LIMITS = {
  display_name: 160,
  first_name: 80,
  last_name: 80,
  company_name: 120,
  phone: 40,
  secondary_phone: 40,
  email: 254,
  notes: 5000,
  service_addresses: 20,
  address_street: 200,
  address_suite: 80,
  address_city: 120,
  address_state: 80,
  address_postal_code: 40,
  address_country: 80,
  search_token_max: 6,
  page_size_max: 100,
} as const;

@Schema({
  collection: 'clients',
  timestamps: {
    createdAt: 'created_at',
    updatedAt: 'updated_at',
  },
})
export class Client {
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
    maxlength: CLIENT_FIELD_LIMITS.display_name,
  })
  display_name!: string;

  @Prop({
    type: String,
    trim: true,
    default: null,
    maxlength: CLIENT_FIELD_LIMITS.first_name,
  })
  first_name!: string | null;

  @Prop({
    type: String,
    trim: true,
    default: null,
    maxlength: CLIENT_FIELD_LIMITS.last_name,
  })
  last_name!: string | null;

  @Prop({
    type: String,
    trim: true,
    default: null,
    maxlength: CLIENT_FIELD_LIMITS.company_name,
  })
  company_name!: string | null;

  @Prop({
    type: String,
    trim: true,
    default: null,
    maxlength: CLIENT_FIELD_LIMITS.phone,
  })
  phone!: string | null;

  @Prop({
    type: String,
    trim: true,
    default: null,
    maxlength: CLIENT_FIELD_LIMITS.secondary_phone,
  })
  secondary_phone!: string | null;

  @Prop({
    type: String,
    trim: true,
    lowercase: true,
    default: null,
    maxlength: CLIENT_FIELD_LIMITS.email,
  })
  email!: string | null;

  @Prop({ type: AddressSchema, default: null })
  billing_address!: Address | null;

  @Prop({ type: [AddressSchema], default: [] })
  service_addresses!: Address[];

  @Prop({
    type: String,
    trim: true,
    default: null,
    maxlength: CLIENT_FIELD_LIMITS.notes,
  })
  notes!: string | null;

  @Prop({ type: Boolean, default: false })
  is_archived!: boolean;

  /** Normalized search helpers — never overwrite display values. */
  @Prop({ type: String, default: '' })
  search_name!: string;

  @Prop({ type: String, default: '' })
  search_company!: string;

  @Prop({ type: String, default: '' })
  search_email!: string;

  @Prop({ type: String, default: '' })
  search_phone!: string;

  @Prop({ type: String, default: '' })
  search_secondary_phone!: string;

  /** Unique normalized email/phone identities used for race-safe deduplication. */
  @Prop({ type: [String], default: [], select: false })
  contact_keys!: string[];

  @Prop({ type: String, trim: true, default: null, maxlength: 120 })
  customer_source!: string | null;

  @Prop({ type: Boolean, default: true })
  allows_phone!: boolean;

  @Prop({ type: Boolean, default: true })
  allows_sms!: boolean;

  @Prop({ type: Boolean, default: true })
  allows_email!: boolean;

  @Prop({ type: SourceMetadataSchema, default: null })
  source_metadata!: SourceMetadata | null;

  @Prop({ type: String, default: '' })
  search_addresses!: string;

  created_at!: Date;
  updated_at!: Date;
}

export const ClientSchema = SchemaFactory.createForClass(Client);

ClientSchema.index({ organization_id: 1, display_name: 1, _id: 1 });
ClientSchema.index({
  organization_id: 1,
  is_archived: 1,
  created_at: -1,
  _id: -1,
});
ClientSchema.index({ organization_id: 1, search_name: 1 });
ClientSchema.index({ organization_id: 1, search_company: 1 });
ClientSchema.index({ organization_id: 1, search_email: 1 });
ClientSchema.index({ organization_id: 1, search_phone: 1 });
ClientSchema.index({ organization_id: 1, search_secondary_phone: 1 });
ClientSchema.index({ organization_id: 1, search_addresses: 1 });
ClientSchema.index(
  { organization_id: 1, contact_keys: 1 },
  {
    unique: true,
    partialFilterExpression: { contact_keys: { $type: 'string' } },
    name: 'uniq_client_contact_identity',
  },
);
ClientSchema.index(
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
    name: 'uniq_client_source_identity',
  },
);
