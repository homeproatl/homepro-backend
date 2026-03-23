import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type AppSettingsDocument = HydratedDocument<AppSettings>;

@Schema({
  collection: 'app_settings',
  timestamps: {
    createdAt: 'created_at',
    updatedAt: 'updated_at',
  },
})
export class AppSettings {
  @Prop({ required: true, unique: true, default: 'app' })
  singleton_key!: string;

  @Prop({ required: true, trim: true })
  business_timezone!: string;
}

export const AppSettingsSchema = SchemaFactory.createForClass(AppSettings);
