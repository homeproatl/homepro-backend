import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import * as bcrypt from 'bcryptjs';
import { UsersService } from '../users/users.service';
import { LoginDto } from './dto/login.dto';

type AuthTokens = {
  accessToken: string;
  refreshToken: string;
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

    return {
      user: this.usersService.toAuthenticatedUser(user),
      ...(await this.issueTokens(user.id, user.email, user.role)),
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

      return {
        user: this.usersService.toAuthenticatedUser(user),
        ...(await this.issueTokens(user.id, user.email, user.role)),
      };
    } catch {
      throw new UnauthorizedException('Invalid refresh token');
    }
  }

  logout(userId: string) {
    return { success: true, userId };
  }

  private async issueTokens(
    userId: string,
    email: string,
    role: string,
  ): Promise<AuthTokens> {
    const accessToken = await this.jwtService.signAsync(
      { sub: userId, email, role, type: 'access' },
      {
        secret: this.configService.getOrThrow<string>('JWT_ACCESS_SECRET'),
        expiresIn: this.configService.getOrThrow<string>(
          'JWT_ACCESS_TTL',
        ) as never,
      },
    );

    const refreshToken = await this.jwtService.signAsync(
      { sub: userId, email, role, type: 'refresh' },
      {
        secret: this.configService.getOrThrow<string>('JWT_REFRESH_SECRET'),
        expiresIn: this.configService.getOrThrow<string>(
          'JWT_REFRESH_TTL',
        ) as never,
      },
    );

    return { accessToken, refreshToken };
  }
}
