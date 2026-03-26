import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import * as bcrypt from 'bcryptjs';
import { createHash, timingSafeEqual } from 'crypto';
import { UsersService } from '../users/users.service';
import { UserDocument } from '../users/schemas/user.schema';
import { LoginDto } from './dto/login.dto';

type AuthTokens = {
  accessToken: string;
  refreshToken: string;
};

type AuthTokenPayload = {
  sub: string;
  email: string;
  role: string;
  type: 'access' | 'refresh';
  token_version?: number;
};

@Injectable()
export class AuthService {
  constructor(
    private readonly usersService: UsersService,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
  ) {}

  async login(payload: LoginDto) {
    const user = await this.usersService.findByEmail(payload.email);

    if (!user || !user.is_active) {
      throw new UnauthorizedException('Invalid credentials');
    }

    const passwordMatches = await bcrypt.compare(
      payload.password,
      user.password_hash,
    );

    if (!passwordMatches) {
      throw new UnauthorizedException('Invalid credentials');
    }

    const tokens = await this.issueTokens(
      user.id,
      user.email,
      user.role,
      this.getTokenVersion(user.token_version),
    );
    await this.storeRefreshTokenHash(user, tokens.refreshToken);

    return {
      user: this.usersService.toAuthenticatedUser(user),
      ...tokens,
    };
  }

  async me(userId: string) {
    const user = await this.usersService.findById(userId);

    if (!user || !user.is_active) {
      throw new UnauthorizedException('User no longer active');
    }

    return this.usersService.toAuthenticatedUser(user);
  }

  async refresh(refreshToken: string) {
    try {
      const payload = this.jwtService.verify<{
        sub: string;
        email: string;
        role: string;
        type: 'access' | 'refresh';
        token_version?: number;
      }>(refreshToken, {
        secret: this.configService.getOrThrow<string>('JWT_REFRESH_SECRET'),
      });

      if (payload.type !== 'refresh') {
        throw new UnauthorizedException('Invalid refresh token');
      }

      const user = await this.usersService.findById(payload.sub);
      if (!user || !user.is_active) {
        throw new UnauthorizedException('User no longer active');
      }

      if (
        this.getTokenVersion(user.token_version) !==
        (payload.token_version ?? 0)
      ) {
        throw new UnauthorizedException('Invalid refresh token');
      }

      if (!this.refreshTokenMatches(refreshToken, user.refresh_token_hash)) {
        throw new UnauthorizedException('Invalid refresh token');
      }

      const tokens = await this.issueTokens(
        user.id,
        user.email,
        user.role,
        this.getTokenVersion(user.token_version),
      );
      await this.storeRefreshTokenHash(user, tokens.refreshToken);

      return {
        user: this.usersService.toAuthenticatedUser(user),
        ...tokens,
      };
    } catch {
      throw new UnauthorizedException('Invalid refresh token');
    }
  }

  async logout(userId: string) {
    const user = await this.usersService.findById(userId);
    if (user) {
      user.token_version = this.getTokenVersion(user.token_version) + 1;
      user.refresh_token_hash = null;
      await user.save();
    }

    return { success: true, userId };
  }

  private async issueTokens(
    userId: string,
    email: string,
    role: string,
    tokenVersion: number,
  ): Promise<AuthTokens> {
    const accessToken = await this.jwtService.signAsync(
      this.buildTokenPayload({
        sub: userId,
        email,
        role,
        type: 'access',
        token_version: tokenVersion,
      }),
      {
        secret: this.configService.getOrThrow<string>('JWT_ACCESS_SECRET'),
        expiresIn: this.configService.getOrThrow<string>(
          'JWT_ACCESS_TTL',
        ) as never,
      },
    );

    const refreshToken = await this.jwtService.signAsync(
      this.buildTokenPayload({
        sub: userId,
        email,
        role,
        type: 'refresh',
        token_version: tokenVersion,
      }),
      {
        secret: this.configService.getOrThrow<string>('JWT_REFRESH_SECRET'),
        expiresIn: this.configService.getOrThrow<string>(
          'JWT_REFRESH_TTL',
        ) as never,
      },
    );

    return { accessToken, refreshToken };
  }

  private buildTokenPayload(payload: AuthTokenPayload) {
    return payload;
  }

  private async storeRefreshTokenHash(
    user: UserDocument,
    refreshToken: string,
  ) {
    user.refresh_token_hash = this.hashRefreshToken(refreshToken);
    await user.save();
  }

  private hashRefreshToken(value: string) {
    return createHash('sha256').update(value).digest('hex');
  }

  private refreshTokenMatches(
    refreshToken: string,
    storedHash: string | null | undefined,
  ) {
    if (!storedHash) {
      return false;
    }

    const presentedHash = this.hashRefreshToken(refreshToken);
    const storedBuffer = Buffer.from(storedHash, 'utf8');
    const presentedBuffer = Buffer.from(presentedHash, 'utf8');

    if (storedBuffer.length !== presentedBuffer.length) {
      return false;
    }

    return timingSafeEqual(storedBuffer, presentedBuffer);
  }

  private getTokenVersion(value: number | null | undefined) {
    return typeof value === 'number' && Number.isFinite(value) ? value : 0;
  }
}
