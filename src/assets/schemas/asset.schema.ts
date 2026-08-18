import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';
import { Organization } from '../../organizations/schemas/organization.schema';
import { User } from '../../users/schemas/user.schema';
import {
  SourceMetadata,
  SourceMetadataSchema,
} from '../../common/schemas/source-metadata.schema';

export type AssetDocument = HydratedDocument<Asset>;

export const ASSET_OWNER_TYPES = [
  'organization',
  'client',
  'document',
  'line_item',
] as const;
export type AssetOwnerType = (typeof ASSET_OWNER_TYPES)[number];

export const ASSET_KINDS = [
  'logo',
  'photo',
  'attachment',
  'signature',
] as const;
export type AssetKind = (typeof ASSET_KINDS)[number];

export const ASSET_STORAGE_PROVIDERS = ['local', 'cloudflare_r2'] as const;
export type AssetStorageProvider = (typeof ASSET_STORAGE_PROVIDERS)[number];

export const ASSET_STATUSES = ['pending', 'ready', 'failed'] as const;
export type AssetStatus = (typeof ASSET_STATUSES)[number];

@Schema({
  collection: 'assets',
  timestamps: {
    createdAt: 'created_at',
    updatedAt: 'updated_at',
  },
})
export class Asset {
  @Prop({
    type: Types.ObjectId,
    ref: Organization.name,
    required: true,
    index: true,
  })
  organization_id!: Types.ObjectId;

  @Prop({ type: String, required: true, enum: ASSET_OWNER_TYPES, index: true })
  owner_type!: AssetOwnerType;

  @Prop({ type: Types.ObjectId, required: true, index: true })
  owner_id!: Types.ObjectId;

  @Prop({ type: String, required: true, enum: ASSET_KINDS, index: true })
  kind!: AssetKind;

  @Prop({ type: String, required: true, trim: true, maxlength: 240 })
  filename!: string;

  @Prop({ type: String, required: true, trim: true, maxlength: 120 })
  mime_type!: string;

  @Prop({ type: Number, required: true, min: 0 })
  size!: number;

  @Prop({ type: String, required: true, enum: ASSET_STORAGE_PROVIDERS })
  storage_provider!: AssetStorageProvider;

  @Prop({ type: String, required: true, trim: true, unique: true })
  storage_key!: string;

  @Prop({ type: String, trim: true, default: null })
  checksum_sha256!: string | null;

  @Prop({ type: String, trim: true, default: null, maxlength: 500 })
  caption!: string | null;

  @Prop({ type: Number, default: 0, min: 0 })
  sort_order!: number;

  @Prop({ type: SourceMetadataSchema, default: null })
  source_metadata!: SourceMetadata | null;

  @Prop({ type: Number, default: null, min: 1 })
  width!: number | null;

  @Prop({ type: Number, default: null, min: 1 })
  height!: number | null;

  @Prop({
    type: String,
    required: true,
    enum: ASSET_STATUSES,
    default: 'pending',
    index: true,
  })
  status!: AssetStatus;

  @Prop({ type: Boolean, required: true, default: false, index: true })
  is_deleted!: boolean;

  @Prop({ type: Types.ObjectId, ref: User.name, default: null })
  created_by_user_id!: Types.ObjectId | null;

  created_at!: Date;
  updated_at!: Date;
}

export const AssetSchema = SchemaFactory.createForClass(Asset);

AssetSchema.index({
  organization_id: 1,
  owner_type: 1,
  owner_id: 1,
  kind: 1,
  is_deleted: 1,
});
AssetSchema.index({ organization_id: 1, status: 1, created_at: -1 });
AssetSchema.index(
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
    name: 'uniq_asset_source_identity',
  },
);
