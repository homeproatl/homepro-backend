import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';
import { UserRole } from '../../common/enums/user-role.enum';

export type UserDocument = HydratedDocument<User>;

@Schema({
  collection: 'users',
  timestamps: {
    createdAt: 'created_at',
    updatedAt: 'updated_at',
  },
})
export class User {
  @Prop({ required: true, trim: true })
  name!: string;

  @Prop({ required: true, unique: true, lowercase: true, trim: true })
  email!: string;

  @Prop({ type: String, trim: true, default: null })
  phone!: string | null;

  @Prop({ required: true })
  password_hash!: string;

  @Prop({
    type: String,
    required: true,
    enum: UserRole,
    default: UserRole.ADMIN,
  })
  role!: UserRole;

  @Prop({ required: true, default: true })
  is_active!: boolean;

  @Prop({ required: true, default: 0 })
  token_version!: number;

  @Prop({ type: String, default: null })
  refresh_token_hash!: string | null;

  @Prop({ type: Types.ObjectId, ref: User.name, default: null, index: true })
  created_by!: Types.ObjectId | null;
}

export const UserSchema = SchemaFactory.createForClass(User);
