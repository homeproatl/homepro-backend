import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';
import { TAG_COLOR_VALUES, type TagColor } from '../tag-colors';
import { TAG_SCOPE_VALUES, type TagScope } from '../tag-scopes';

export type TagDocument = HydratedDocument<Tag>;

@Schema({ _id: false, id: false })
export class EmbeddedTag {
  @Prop({ type: Types.ObjectId, ref: 'Tag', default: null })
  tag_id!: Types.ObjectId | null;

  @Prop({ type: String, required: true, enum: TAG_SCOPE_VALUES })
  scope!: TagScope;

  @Prop({ required: true, trim: true })
  name!: string;

  @Prop({ type: String, required: true, enum: TAG_COLOR_VALUES })
  color!: TagColor;
}

export const EmbeddedTagSchema = SchemaFactory.createForClass(EmbeddedTag);

@Schema({
  collection: 'tags',
  timestamps: {
    createdAt: 'created_at',
    updatedAt: 'updated_at',
  },
})
export class Tag {
  @Prop({ type: String, required: true, enum: TAG_SCOPE_VALUES })
  scope!: TagScope;

  @Prop({ required: true, trim: true })
  name!: string;

  @Prop({ required: true, trim: true })
  normalized_name!: string;

  @Prop({ type: String, required: true, enum: TAG_COLOR_VALUES })
  color!: TagColor;

  created_at!: Date;

  updated_at!: Date;
}

export const TagSchema = SchemaFactory.createForClass(Tag);

TagSchema.index({ scope: 1, normalized_name: 1 }, { unique: true });
