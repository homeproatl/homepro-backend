import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';
import { Organization } from '../../organizations/schemas/organization.schema';
import {
  SourceMetadata,
  SourceMetadataSchema,
} from '../../common/schemas/source-metadata.schema';

export type ItemDocument = HydratedDocument<Item>;

export const ITEM_TYPE_VALUES = [
  'service',
  'labor',
  'material',
  'equipment',
  'other',
] as const;
export type ItemType = (typeof ITEM_TYPE_VALUES)[number];

export const MARKUP_TYPE_VALUES = ['none', 'percent', 'fixed'] as const;
export type MarkupType = (typeof MARKUP_TYPE_VALUES)[number];

/** Suggested units; custom strings are still accepted within length limits. */
export const SUGGESTED_UNIT_OF_MEASURE_VALUES = [
  'each',
  'ea',
  'hour',
  'day',
  'sq ft',
  'sf',
  'linear ft',
  'lf',
  'cu yd',
  'cy',
  'gallon',
  'box',
  'bundle',
  'lot',
] as const;

export const ITEM_FIELD_LIMITS = {
  name: 160,
  description_template: 5000,
  unit_of_measure: 40,
  vendor_name: 120,
  sku_or_part_number: 120,
  category: 80,
  page_size_max: 100,
  search_token_max: 6,
  waste_basis_points_max: 100_000, // 1000%
  markup_value_max: 1_000_000_000,
  rate_minor_max: 1_000_000_000,
} as const;

@Schema({
  collection: 'items',
  timestamps: {
    createdAt: 'created_at',
    updatedAt: 'updated_at',
  },
})
export class Item {
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
    maxlength: ITEM_FIELD_LIMITS.name,
  })
  name!: string;

  @Prop({
    required: true,
    trim: true,
    maxlength: ITEM_FIELD_LIMITS.name,
  })
  normalized_name!: string;

  @Prop({
    type: String,
    required: true,
    enum: ITEM_TYPE_VALUES,
    default: 'service',
  })
  item_type!: ItemType;

  @Prop({
    type: String,
    trim: true,
    default: null,
    maxlength: ITEM_FIELD_LIMITS.description_template,
  })
  description_template!: string | null;

  @Prop({
    type: Number,
    required: true,
    min: 0,
    default: 0,
  })
  default_rate_minor!: number;

  @Prop({
    type: String,
    trim: true,
    default: null,
    maxlength: ITEM_FIELD_LIMITS.unit_of_measure,
  })
  default_unit_of_measure!: string | null;

  @Prop({
    type: Number,
    default: null,
    min: 0,
  })
  default_internal_unit_cost_minor!: number | null;

  @Prop({
    type: String,
    trim: true,
    default: null,
    maxlength: ITEM_FIELD_LIMITS.vendor_name,
  })
  default_vendor_name!: string | null;

  @Prop({
    type: String,
    trim: true,
    default: null,
    maxlength: ITEM_FIELD_LIMITS.sku_or_part_number,
  })
  default_sku_or_part_number!: string | null;

  @Prop({
    type: Number,
    required: true,
    min: 0,
    default: 0,
  })
  default_waste_basis_points!: number;

  @Prop({
    type: String,
    required: true,
    enum: MARKUP_TYPE_VALUES,
    default: 'none',
  })
  default_markup_type!: MarkupType;

  @Prop({
    type: Number,
    required: true,
    min: 0,
    default: 0,
  })
  default_markup_value!: number;

  @Prop({ type: Boolean, default: true })
  taxable_default!: boolean;

  @Prop({
    type: String,
    trim: true,
    default: null,
    maxlength: ITEM_FIELD_LIMITS.category,
  })
  category!: string | null;

  @Prop({ type: Boolean, default: true })
  is_active!: boolean;

  /** Joist can assign multiple taxes to one catalog item. */
  @Prop({ type: [Types.ObjectId], default: [] })
  tax_ids!: Types.ObjectId[];

  @Prop({ type: String, trim: true, default: null, maxlength: 5000 })
  private_notes!: string | null;

  @Prop({ type: SourceMetadataSchema, default: null })
  source_metadata!: SourceMetadata | null;

  /** Exact source decimal retained when an imported rate has sub-cent precision. */
  @Prop({ type: String, trim: true, default: null, maxlength: 80 })
  source_rate_decimal!: string | null;
}

export const ItemSchema = SchemaFactory.createForClass(Item);

// Imported Joist catalogs may contain duplicate names. Keep the existing
// normalized-name guard for native records, while allowing source-identified
// records to retain their original identity without being merged.
ItemSchema.index(
  { organization_id: 1, normalized_name: 1 },
  {
    unique: true,
    partialFilterExpression: {
      source_metadata: { $type: 'null' },
    },
  },
);
ItemSchema.index(
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
    name: 'uniq_item_source_identity',
  },
);
ItemSchema.index({ organization_id: 1, is_active: 1, name: 1, _id: 1 });
ItemSchema.index({ organization_id: 1, item_type: 1, is_active: 1 });
ItemSchema.index({ organization_id: 1, category: 1, is_active: 1 });
