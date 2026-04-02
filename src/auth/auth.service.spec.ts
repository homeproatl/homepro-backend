import { UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { createHash } from 'crypto';
import { AuthService } from './auth.service';
import { UsersService } from '../users/users.service';

describe('AuthService', () => {
  it('increments token version on logout so older refresh tokens are invalidated', async () => {
    const user = {
      id: '507f1f77bcf86cd799439011',
      token_version: 2,
      refresh_token_hash: 'existing-hash',
      save: jest.fn().mockResolvedValue(undefined),
    };
    const usersService = {
      findById: jest.fn().mockResolvedValue(user),
    } as unknown as UsersService;
    const service = new AuthService(
      usersService,
      {} as JwtService,
      {} as ConfigService,
    );

    await expect(service.logout(user.id)).resolves.toEqual({
      success: true,
      userId: user.id,
    });
    expect(user.token_version).toBe(3);
    expect(user.refresh_token_hash).toBeNull();
    expect(user.save).toHaveBeenCalled();
  });

  it('rejects refresh tokens whose token version no longer matches the user record', async () => {
    const usersService = {
      findById: jest.fn().mockResolvedValue({
        id: '507f1f77bcf86cd799439011',
        email: 'rico@admin.com',
        role: 'ADMIN',
        is_active: true,
        token_version: 4,
      }),
      toAuthenticatedUser: jest.fn(),
    } as unknown as UsersService;
    const jwtService = {
      verify: jest.fn().mockReturnValue({
        sub: '507f1f77bcf86cd799439011',
        email: 'rico@admin.com',
        role: 'ADMIN',
        type: 'refresh',
        token_version: 3,
      }),
    } as unknown as JwtService;
    const configService = {
      getOrThrow: jest.fn().mockReturnValue('refresh-secret'),
    } as unknown as ConfigService;
    const service = new AuthService(usersService, jwtService, configService);

    await expect(service.refresh('stale-refresh-token')).rejects.toThrow(
      UnauthorizedException,
    );
  });

  it('rotates the stored refresh token hash after a successful refresh', async () => {
    const user = {
      id: '507f1f77bcf86cd799439011',
      email: 'rico@admin.com',
      role: 'ADMIN',
      is_active: true,
      token_version: 4,
      refresh_token_hash: createHash('sha256')
        .update('current-refresh-token')
        .digest('hex'),
      save: jest.fn().mockResolvedValue(undefined),
    };
    const usersService = {
      findById: jest.fn().mockResolvedValue(user),
      toAuthenticatedUser: jest.fn().mockReturnValue({
        id: user.id,
        email: user.email,
        role: user.role,
      }),
    } as unknown as UsersService;
    const jwtService = {
      verify: jest.fn().mockReturnValue({
        sub: user.id,
        email: user.email,
        role: user.role,
        type: 'refresh',
        token_version: 4,
      }),
      signAsync: jest
        .fn()
        .mockResolvedValueOnce('next-access-token')
        .mockResolvedValueOnce('next-refresh-token'),
    } as unknown as JwtService;
    const configService = {
      getOrThrow: jest.fn((key: string) => {
        switch (key) {
          case 'JWT_REFRESH_SECRET':
            return 'refresh-secret';
          case 'JWT_ACCESS_SECRET':
            return 'access-secret';
          case 'JWT_ACCESS_TTL':
            return '15m';
          case 'JWT_REFRESH_TTL':
            return '7d';
          default:
            return 'ignored';
        }
      }),
    } as unknown as ConfigService;
    const service = new AuthService(usersService, jwtService, configService);

    await expect(
      service.refresh('current-refresh-token'),
    ).resolves.toMatchObject({
      accessToken: 'next-access-token',
      refreshToken: 'next-refresh-token',
    });
    expect(user.refresh_token_hash).toBe(
      createHash('sha256').update('next-refresh-token').digest('hex'),
    );
    expect(user.save).toHaveBeenCalled();
  });
});
