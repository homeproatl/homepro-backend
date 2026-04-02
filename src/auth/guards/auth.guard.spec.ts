import { UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { UsersService } from '../../users/users.service';
import { AuthGuard } from './auth.guard';

describe('AuthGuard', () => {
  it('rejects requests without bearer token', async () => {
    const jwtService = { verify: jest.fn() } as unknown as JwtService;
    const configService = {
      getOrThrow: jest.fn().mockReturnValue('secret'),
    } as unknown as ConfigService;
    const usersService = {
      findById: jest.fn(),
    } as unknown as UsersService;
    const guard = new AuthGuard(jwtService, configService, usersService);

    const request = { headers: {} };
    const context = {
      switchToHttp: () => ({ getRequest: () => request }),
    } as never;

    await expect(guard.canActivate(context)).rejects.toThrow(
      UnauthorizedException,
    );
  });

  it('accepts valid access token and populates request user', async () => {
    const payload = {
      sub: '507f1f77bcf86cd799439011',
      email: 'rico@admin.com',
      role: 'ADMIN',
      type: 'access' as const,
      token_version: 3,
    };
    const jwtService = {
      verify: jest.fn().mockReturnValue(payload),
    } as unknown as JwtService;
    const configService = {
      getOrThrow: jest.fn().mockReturnValue('secret'),
    } as unknown as ConfigService;
    const usersService = {
      findById: jest.fn().mockResolvedValue({
        id: payload.sub,
        is_active: true,
        token_version: 3,
      }),
    } as unknown as UsersService;
    const guard = new AuthGuard(jwtService, configService, usersService);

    const request: { headers: { authorization: string }; user?: unknown } = {
      headers: { authorization: 'Bearer token' },
    };
    const context = {
      switchToHttp: () => ({ getRequest: () => request }),
    } as never;

    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(request.user).toEqual(payload);
  });

  it('rejects tokens that were issued before logout incremented token version', async () => {
    const payload = {
      sub: '507f1f77bcf86cd799439011',
      email: 'rico@admin.com',
      role: 'ADMIN',
      type: 'access' as const,
      token_version: 1,
    };
    const jwtService = {
      verify: jest.fn().mockReturnValue(payload),
    } as unknown as JwtService;
    const configService = {
      getOrThrow: jest.fn().mockReturnValue('secret'),
    } as unknown as ConfigService;
    const usersService = {
      findById: jest.fn().mockResolvedValue({
        id: payload.sub,
        is_active: true,
        token_version: 2,
      }),
    } as unknown as UsersService;
    const guard = new AuthGuard(jwtService, configService, usersService);

    const request: { headers: { authorization: string }; user?: unknown } = {
      headers: { authorization: 'Bearer stale-token' },
    };
    const context = {
      switchToHttp: () => ({ getRequest: () => request }),
    } as never;

    await expect(guard.canActivate(context)).rejects.toThrow(
      UnauthorizedException,
    );
  });
});
