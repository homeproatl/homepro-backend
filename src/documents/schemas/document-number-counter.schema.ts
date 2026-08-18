import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';
import { Organization } from '../../organizations/schemas/organization.schema';
import { DOCUMENT_TYPE_VALUES, type DocumentType } from '../document-status';

export type DocumentNumberCounterDocument =
  HydratedDocument<DocumentNumberCounter>;

@Schema({
  collection: 'document_number_counters',
  timestamps: {
    createdAt: 'created_at',
    updatedAt: 'updated_at',
  },
})
export class DocumentNumberCounter {
  @Prop({
    type: Types.ObjectId,
    ref: Organization.name,
    required: true,
  })
  organization_id!: Types.ObjectId;

  @Prop({
    type: String,
    required: true,
    enum: DOCUMENT_TYPE_VALUES,
  })
  document_type!: DocumentType;

  /**
   * Counter value. Starts at 0; allocate does `$inc: 1` and returns the
   * post-increment value (so the first number is 1).
   * Stored value equals the highest allocated sequence.
   */
  @Prop({ type: Number, required: true, min: 0, default: 0 })
  next_value!: number;

  /**
   * Optional display prefix. When null/absent, allocate uses EST/INV defaults.
   * Prefix changes apply only to future allocations.
   */
  @Prop({ type: String, trim: true, default: null, maxlength: 20 })
  prefix!: string | null;

  created_at!: Date;
  updated_at!: Date;
}

export const DocumentNumberCounterSchema = SchemaFactory.createForClass(
  DocumentNumberCounter,
);

DocumentNumberCounterSchema.index(
  { organization_id: 1, document_type: 1 },
  { unique: true },
);
