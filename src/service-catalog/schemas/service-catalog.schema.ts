import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';
import { EmbeddedTag, EmbeddedTagSchema } from '../../tags/schemas/tag.schema';

export type ServiceCatalogDocument = HydratedDocument<ServiceCatalog>;

@Schema({ _id: true, id: false })
export class ServiceCatalogLaborLine {
  @Prop({ required: true, trim: true })
  description!: string;

  @Prop({ required: true, min: 0 })
  hours!: number;

  @Prop({ required: true, min: 0 })
  rate!: number;

  @Prop({ required: true, min: 0, max: 100, default: 0 })
  discount_percent!: number;

  @Prop({ required: true, min: 0, default: 0 })
  subtotal!: number;

  @Prop({ type: [EmbeddedTagSchema], default: [] })
  tags!: EmbeddedTag[];
}

export const ServiceCatalogLaborLineSchema = SchemaFactory.createForClass(
  ServiceCatalogLaborLine,
);

@Schema({ _id: true, id: false })
export class ServiceCatalogPartLine {
  @Prop({ required: true, trim: true })
  name!: string;

  @Prop({ type: String, trim: true, default: null })
  part_number!: string | null;

  @Prop({ required: true, min: 1 })
  quantity!: number;

  @Prop({ type: Number, default: null, min: 0 })
  cost!: number | null;

  @Prop({ required: true, min: 0 })
  price!: number;

  @Prop({ required: true, min: 0, max: 100, default: 0 })
  discount_percent!: number;

  @Prop({ required: true, min: 0, default: 0 })
  subtotal!: number;

  @Prop({ type: [EmbeddedTagSchema], default: [] })
  tags!: EmbeddedTag[];
}

export const ServiceCatalogPartLineSchema = SchemaFactory.createForClass(
  ServiceCatalogPartLine,
);

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

  @Prop({ required: true, trim: true })
  normalized_name!: string;

  @Prop({ type: String, trim: true, default: null })
  note!: string | null;

  @Prop({ type: Boolean, default: true })
  is_active!: boolean;

  @Prop({
    type: [ServiceCatalogLaborLineSchema],
    default: [],
  })
  labor_lines!: ServiceCatalogLaborLine[];

  @Prop({
    type: [ServiceCatalogPartLineSchema],
    default: [],
  })
  part_lines!: ServiceCatalogPartLine[];

  @Prop({ type: Number, required: true, default: 0, min: 0 })
  labor_total!: number;

  @Prop({ type: Number, required: true, default: 0, min: 0 })
  parts_total!: number;

  @Prop({ type: Number, required: true, default: 0, min: 0 })
  total!: number;
}

export const ServiceCatalogSchema =
  SchemaFactory.createForClass(ServiceCatalog);

ServiceCatalogSchema.index({ normalized_name: 1 });
