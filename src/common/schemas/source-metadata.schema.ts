import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';

/** Immutable identity used to reconcile records imported from external systems. */
@Schema({ _id: false, id: false })
export class SourceMetadata {
  @Prop({ type: String, trim: true, default: null, maxlength: 80 })
  source_system!: string | null;

  @Prop({ type: String, trim: true, default: null, maxlength: 160 })
  source_account_id!: string | null;

  @Prop({ type: String, trim: true, default: null, maxlength: 80 })
  source_entity!: string | null;

  @Prop({ type: String, trim: true, default: null, maxlength: 240 })
  source_id!: string | null;

  @Prop({ type: Date, default: null })
  source_created_at!: Date | null;

  @Prop({ type: Date, default: null })
  source_updated_at!: Date | null;

  @Prop({ type: String, trim: true, default: null, maxlength: 128 })
  raw_sha256!: string | null;

  @Prop({ type: String, trim: true, default: null, maxlength: 120 })
  import_batch_id!: string | null;
}

export const SourceMetadataSchema =
  SchemaFactory.createForClass(SourceMetadata);
