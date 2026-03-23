import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';
import { User } from '../../users/schemas/user.schema';

export type AuditLogDocument = HydratedDocument<AuditLog>;

@Schema({
  collection: 'audit_logs',
  timestamps: {
    createdAt: 'created_at',
    updatedAt: 'updated_at',
  },
})
export class AuditLog {
  @Prop({ type: Types.ObjectId, ref: User.name, default: null, index: true })
  actor_user_id!: Types.ObjectId | null;

  @Prop({ required: true, trim: true, index: true })
  entity_type!: string;

  @Prop({ required: true, trim: true, index: true })
  entity_id!: string;

  @Prop({ required: true, trim: true })
  action!: string;

  @Prop({ type: Object, default: null })
  before_json!: Record<string, unknown> | null;

  @Prop({ type: Object, default: null })
  after_json!: Record<string, unknown> | null;
}

export const AuditLogSchema = SchemaFactory.createForClass(AuditLog);

AuditLogSchema.index({ entity_type: 1, entity_id: 1, created_at: -1 });
