import { UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { AuthService } from './auth.service';
import { UsersService } from '../users/users.service';

describe('AuthService', () => {
  it('increments token version on logout so older refresh tokens are invalidated', async () => {
    const user = {
      id: '507f1f77bcf86cd799439011',
      token_version: 2,
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
    expect(user.save).toHaveBeenCalled();
  });

  it('rejects refresh tokens whose token version no longer matches the user record', async () => {
    const usersService = {
      findById: jest.fn().mockResolvedValue({
        id: '507f1f77bcf86cd799439011',
        email: 'rico@admin.com',
        role: 'SUPER_ADMIN',
        is_active: true,
        token_version: 4,
      }),
      toAuthenticatedUser: jest.fn(),
    } as unknown as UsersService;
    const jwtService = {
      verify: jest.fn().mockReturnValue({
        sub: '507f1f77bcf86cd799439011',
        email: 'rico@admin.com',
        role: 'SUPER_ADMIN',
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
});
