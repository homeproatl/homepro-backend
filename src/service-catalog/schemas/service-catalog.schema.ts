import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type ServiceCatalogDocument = HydratedDocument<ServiceCatalog>;

@Schema({
  collection: 'services',
  timestamps: {
    createdAt: 'created_at',
    updatedAt: 'updated_at',
  },
})
export class ServiceCatalog {
  @Prop({ required: true, trim: true })
  name!: string;

  @Prop({ type: Number, default: null })
  base_price!: number | null;

  @Prop({ type: Number, default: null })
  estimated_duration_minutes!: number | null;
}

export const ServiceCatalogSchema =
  SchemaFactory.createForClass(ServiceCatalog);

ServiceCatalogSchema.index({ name: 1 }, { unique: true });
