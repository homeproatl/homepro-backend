import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';
import { Customer } from '../../customers/schemas/customer.schema';

export type VehicleDocument = HydratedDocument<Vehicle>;

@Schema({
  collection: 'vehicles',
  timestamps: {
    createdAt: 'created_at',
    updatedAt: 'updated_at',
  },
})
export class Vehicle {
  @Prop({
    type: Types.ObjectId,
    ref: Customer.name,
    required: true,
    index: true,
  })
  customer_id!: Types.ObjectId;

  @Prop({ type: String, trim: true, default: null })
  color!: string | null;

  @Prop({ type: Number, default: null })
  year!: number | null;

  @Prop({ required: true, trim: true })
  make!: string;

  @Prop({ required: true, trim: true })
  model!: string;

  @Prop({ type: String, trim: true, default: null })
  sub_model!: string | null;

  @Prop({ type: Number, default: null })
  mileage!: number | null;

  @Prop({ required: true, trim: true, uppercase: true, unique: true })
  vin!: string;

  @Prop({ required: true, trim: true, uppercase: true, unique: true })
  license_plate!: string;
}

export const VehicleSchema = SchemaFactory.createForClass(Vehicle);
