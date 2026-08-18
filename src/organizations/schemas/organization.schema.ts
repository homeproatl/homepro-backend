import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type OrganizationDocument = HydratedDocument<Organization>;

@Schema({
  collection: 'organizations',
  timestamps: {
    createdAt: 'created_at',
    updatedAt: 'updated_at',
  },
})
export class Organization {
  @Prop({ required: true, trim: true })
  name!: string;

  @Prop({ required: true, lowercase: true, trim: true })
  normalized_slug!: string;

  @Prop({ required: true, default: true, index: true })
  is_active!: boolean;

  created_at!: Date;
  updated_at!: Date;
}

export const OrganizationSchema = SchemaFactory.createForClass(Organization);

OrganizationSchema.index({ normalized_slug: 1 }, { unique: true });
