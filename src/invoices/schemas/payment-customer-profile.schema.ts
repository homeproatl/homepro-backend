import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';
import { Client } from '../../clients/schemas/client.schema';
import { Organization } from '../../organizations/schemas/organization.schema';

export type PaymentCustomerProfileDocument =
  HydratedDocument<PaymentCustomerProfile>;

@Schema({
  collection: 'payment_customer_profiles',
  timestamps: {
    createdAt: 'created_at',
    updatedAt: 'updated_at',
  },
})
export class PaymentCustomerProfile {
  @Prop({
    type: Types.ObjectId,
    ref: Organization.name,
    required: true,
    index: true,
  })
  organization_id!: Types.ObjectId;

  @Prop({
    type: Types.ObjectId,
    ref: Client.name,
    required: true,
    index: true,
  })
  client_id!: Types.ObjectId;

  @Prop({ type: String, required: true, enum: ['stripe'], default: 'stripe' })
  provider!: 'stripe';

  @Prop({ type: String, required: true, trim: true })
  provider_customer_id!: string;

  @Prop({ type: String, trim: true, default: null })
  provider_account_id!: string | null;

  @Prop({ type: Boolean, required: true, default: false })
  provider_livemode!: boolean;

  @Prop({ type: String, trim: true, default: null })
  email_snapshot!: string | null;

  @Prop({ type: String, trim: true, default: null })
  name_snapshot!: string | null;

  created_at!: Date;
  updated_at!: Date;
}

export const PaymentCustomerProfileSchema = SchemaFactory.createForClass(
  PaymentCustomerProfile,
);

PaymentCustomerProfileSchema.index(
  {
    organization_id: 1,
    provider: 1,
    provider_account_id: 1,
    provider_livemode: 1,
    client_id: 1,
  },
  { unique: true },
);
PaymentCustomerProfileSchema.index(
  {
    organization_id: 1,
    provider: 1,
    provider_account_id: 1,
    provider_livemode: 1,
    provider_customer_id: 1,
  },
  { unique: true },
);
