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

  @Prop({ type: Number, default: null })
  mileage_out!: number | null;

  @Prop({ type: String, trim: true, uppercase: true, default: null })
  vin!: string | null;

  @Prop({ type: String, trim: true, uppercase: true, default: null })
  license_plate!: string | null;

  @Prop({ type: Boolean, default: false, index: true })
  is_incomplete!: boolean;

  @Prop({ type: Boolean, default: false, index: true })
  is_archived!: boolean;
}

export const VehicleSchema = SchemaFactory.createForClass(Vehicle);

VehicleSchema.index(
  { vin: 1 },
  {
    name: 'vin_1',
    unique: true,
    partialFilterExpression: {
      vin: { $type: 'string' },
    },
  },
);

VehicleSchema.index(
  { license_plate: 1 },
  {
    name: 'license_plate_1',
    unique: true,
    partialFilterExpression: {
      license_plate: { $type: 'string' },
    },
  },
);
