import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import * as bcrypt from 'bcryptjs';
import { UserRole } from '../common/enums/user-role.enum';
import { UserContract } from '../common/contracts/domain.contract';
import { asObjectId } from '../common/utils/object-id';
import { User, UserDocument } from './schemas/user.schema';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';

export type AuthenticatedUser = Pick<
  UserContract,
  'id' | 'name' | 'email' | 'role'
>;

@Injectable()
export class UsersService {
  constructor(
    @InjectModel(User.name) private readonly userModel: Model<UserDocument>,
    private readonly configService: ConfigService,
  ) {}

  async findByEmail(email: string): Promise<UserDocument | null> {
    return this.userModel.findOne({ email: email.toLowerCase() }).exec();
  }

  async findById(id: string): Promise<UserDocument | null> {
    return this.userModel.findById(id).exec();
  }

  async createUser(
    payload: CreateUserDto,
    actorUserId: string,
  ): Promise<UserContract> {
    const email = payload.email.toLowerCase();
    const existing = await this.findByEmail(email);
    if (existing) {
      throw new ConflictException('User email already exists');
    }

    const passwordHash = await bcrypt.hash(payload.password, 10);

    const created = await this.userModel.create({
      name: payload.name,
      email,
      phone: payload.phone ?? null,
      password_hash: passwordHash,
      role: payload.role,
      is_active: payload.is_active ?? true,
      created_by: new Types.ObjectId(actorUserId),
    });

    return this.toUserContract(created);
  }

  async getUsers(): Promise<UserContract[]> {
    const users = await this.userModel
      .find({}, { password_hash: 0 })
      .sort({ created_at: -1 })
      .exec();
    return users.map((user) => this.toUserContract(user));
  }

  async getUserById(id: string): Promise<UserContract> {
    const user = await this.findById(id);
    if (!user) {
      throw new NotFoundException('User not found');
    }

    return this.toUserContract(user);
  }

  async updateUser(id: string, payload: UpdateUserDto): Promise<UserContract> {
    const userId = asObjectId(id, 'user id');
    const existing = await this.userModel.findById(userId).exec();
    if (!existing) {
      throw new NotFoundException('User not found');
    }

    let shouldInvalidateAuthSession = false;

    if (payload.email && payload.email.toLowerCase() !== existing.email) {
      const conflict = await this.findByEmail(payload.email);
      if (conflict && String(conflict._id) !== String(existing._id)) {
        throw new ConflictException('User email already exists');
      }
      existing.email = payload.email.toLowerCase();
      shouldInvalidateAuthSession = true;
    }

    if (payload.name !== undefined) {
      existing.name = payload.name;
    }

    if (payload.phone !== undefined) {
      existing.phone = payload.phone;
    }

    if (payload.role !== undefined) {
      existing.role = payload.role;
      shouldInvalidateAuthSession = true;
    }

    if (payload.is_active !== undefined) {
      existing.is_active = payload.is_active;
      shouldInvalidateAuthSession = true;
    }

    if (payload.password) {
      existing.password_hash = await bcrypt.hash(payload.password, 10);
      shouldInvalidateAuthSession = true;
    }

    if (shouldInvalidateAuthSession) {
      existing.token_version =
        (typeof existing.token_version === 'number' &&
        Number.isFinite(existing.token_version)
          ? existing.token_version
          : 0) + 1;
      existing.refresh_token_hash = null;
    }

    await existing.save();
    return this.toUserContract(existing);
  }

  async ensureSuperAdmin(): Promise<UserDocument> {
    const email = this.configService
      .getOrThrow<string>('SUPER_ADMIN_EMAIL')
      .toLowerCase();
    const name = this.configService.getOrThrow<string>('SUPER_ADMIN_NAME');
    const password = this.configService.getOrThrow<string>(
      'SUPER_ADMIN_PASSWORD',
    );

    const existingUser = await this.findByEmail(email);
    if (existingUser) {
      let needsSave = false;

      if (existingUser.role !== UserRole.SUPER_ADMIN) {
        existingUser.role = UserRole.SUPER_ADMIN;
        needsSave = true;
      }

      if (!existingUser.is_active) {
        existingUser.is_active = true;
        needsSave = true;
      }

      if (needsSave) {
        await existingUser.save();
      }

      return existingUser;
    }

    const passwordHash = await bcrypt.hash(password, 10);

    return this.userModel.create({
      name,
      email,
      password_hash: passwordHash,
      role: UserRole.SUPER_ADMIN,
      is_active: true,
      created_by: null,
      phone: null,
    });
  }

  toAuthenticatedUser(user: UserDocument): AuthenticatedUser {
    return {
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
    };
  }

  toUserContract(user: UserDocument): UserContract {
    return {
      id: user.id,
      name: user.name,
      email: user.email,
      phone: user.phone,
      role: user.role,
      is_active: user.is_active,
      created_by: user.created_by ? String(user.created_by) : null,
      created_at: (
        user as unknown as { created_at?: Date }
      ).created_at?.toISOString(),
      updated_at: (
        user as unknown as { updated_at?: Date }
      ).updated_at?.toISOString(),
    };
  }
}
