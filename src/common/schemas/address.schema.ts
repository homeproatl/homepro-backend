import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';

@Schema({ _id: false, id: false })
export class Address {
  @Prop({ type: String, trim: true, default: null })
  street!: string | null;

  @Prop({ type: String, trim: true, default: null })
  suite!: string | null;

  @Prop({ type: String, trim: true, default: null })
  city!: string | null;

  @Prop({ type: String, trim: true, default: null })
  state!: string | null;

  @Prop({ type: String, trim: true, default: null })
  postal_code!: string | null;

  @Prop({ type: String, trim: true, default: null })
  country!: string | null;
}

export const AddressSchema = SchemaFactory.createForClass(Address);
