import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';
import { Organization } from '../../organizations/schemas/organization.schema';

export type TaxRateDocument = HydratedDocument<TaxRate>;

export const TAX_RATE_FIELD_LIMITS = {
  name: 120,
  rate_basis_points_max: 100_000,
} as const;

/** Default NYC-ish combined rate used for bootstrap: 8.875% = 887.5 → 888 bps (half-up). */
export const DEFAULT_TAX_RATE_BASIS_POINTS = 888;
export const DEFAULT_TAX_RATE_NAME = 'Default Sales Tax';

@Schema({
  collection: 'tax_rates',
  timestamps: {
    createdAt: 'created_at',
    updatedAt: 'updated_at',
  },
})
export class TaxRate {
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
    maxlength: TAX_RATE_FIELD_LIMITS.name,
  })
  name!: string;

  @Prop({
    required: true,
    trim: true,
    maxlength: TAX_RATE_FIELD_LIMITS.name,
  })
  normalized_name!: string;

  @Prop({
    type: Number,
    required: true,
    min: 0,
    max: TAX_RATE_FIELD_LIMITS.rate_basis_points_max,
  })
  rate_basis_points!: number;

  @Prop({ type: Boolean, default: false })
  is_default!: boolean;

  @Prop({ type: Boolean, default: true })
  is_active!: boolean;

  created_at!: Date;
  updated_at!: Date;
}

export const TaxRateSchema = SchemaFactory.createForClass(TaxRate);

TaxRateSchema.index(
  { organization_id: 1, normalized_name: 1 },
  { unique: true },
);
TaxRateSchema.index({ organization_id: 1, is_active: 1 });
