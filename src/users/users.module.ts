import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { MongooseModule } from '@nestjs/mongoose';
import { User, UserSchema } from './schemas/user.schema';
import { UsersService } from './users.service';
import { UsersController } from './users.controller';
import { JwtModule } from '@nestjs/jwt';
import { AuthGuard } from '../auth/guards/auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { UsersBootstrapService } from './users-bootstrap.service';
import { OrganizationsModule } from '../organizations/organizations.module';

@Module({
  imports: [
    ConfigModule,
    JwtModule.register({}),
    OrganizationsModule,
    MongooseModule.forFeature([{ name: User.name, schema: UserSchema }]),
  ],
  controllers: [UsersController],
  providers: [UsersService, UsersBootstrapService, AuthGuard, RolesGuard],
  exports: [UsersService],
})
export class UsersModule {}
