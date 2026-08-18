import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { ConfigModule } from '@nestjs/config';
import { MongooseModule } from '@nestjs/mongoose';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { UsersModule } from '../users/users.module';
import { OrganizationsModule } from '../organizations/organizations.module';
import { AuthGuard } from './guards/auth.guard';
import { RolesGuard } from './guards/roles.guard';
import { AuthRateLimitService } from './auth-rate-limit.service';
import { CsrfOriginGuard } from './guards/csrf-origin.guard';
import { LoginRateLimitGuard } from './guards/login-rate-limit.guard';
import { RefreshRateLimitGuard } from './guards/refresh-rate-limit.guard';
import {
  AuthRateLimit,
  AuthRateLimitSchema,
} from './schemas/auth-rate-limit.schema';

@Module({
  imports: [
    ConfigModule,
    JwtModule.register({}),
    UsersModule,
    OrganizationsModule,
    MongooseModule.forFeature([
      { name: AuthRateLimit.name, schema: AuthRateLimitSchema },
    ]),
  ],
  controllers: [AuthController],
  providers: [
    AuthService,
    AuthGuard,
    RolesGuard,
    AuthRateLimitService,
    CsrfOriginGuard,
    LoginRateLimitGuard,
    RefreshRateLimitGuard,
  ],
  exports: [
    AuthService,
    AuthGuard,
    RolesGuard,
    JwtModule,
    UsersModule,
    OrganizationsModule,
    AuthRateLimitService,
    CsrfOriginGuard,
    LoginRateLimitGuard,
    RefreshRateLimitGuard,
  ],
})
export class AuthModule {}
