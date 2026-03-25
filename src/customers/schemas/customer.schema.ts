import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type CustomerDocument = HydratedDocument<Customer>;

@Schema({
  collection: 'customers',
  timestamps: {
    createdAt: 'created_at',
    updatedAt: 'updated_at',
  },
})
export class Customer {
  @Prop({ required: true, trim: true })
  first_name!: string;

  @Prop({ required: true, trim: true })
  last_name!: string;

  @Prop({ required: true, trim: true })
  phone!: string;

  @Prop({ type: String, trim: true, lowercase: true, default: null })
  email!: string | null;

  @Prop({ type: Boolean, default: false, index: true })
  is_archived!: boolean;
}

export const CustomerSchema = SchemaFactory.createForClass(Customer);

CustomerSchema.index({ last_name: 1, first_name: 1 });
