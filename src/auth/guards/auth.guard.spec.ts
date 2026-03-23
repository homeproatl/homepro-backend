import { UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { AuthGuard } from './auth.guard';

describe('AuthGuard', () => {
  it('rejects requests without bearer token', () => {
    const jwtService = { verify: jest.fn() } as unknown as JwtService;
    const configService = {
      getOrThrow: jest.fn().mockReturnValue('secret'),
    } as unknown as ConfigService;
    const guard = new AuthGuard(jwtService, configService);

    const request = { headers: {} };
    const context = {
      switchToHttp: () => ({ getRequest: () => request }),
    } as never;

    expect(() => guard.canActivate(context)).toThrow(UnauthorizedException);
  });

  it('accepts valid access token and populates request user', () => {
    const payload = {
      sub: '507f1f77bcf86cd799439011',
      email: 'rico@admin.com',
      role: 'SUPER_ADMIN',
      type: 'access' as const,
    };
    const jwtService = {
      verify: jest.fn().mockReturnValue(payload),
    } as unknown as JwtService;
    const configService = {
      getOrThrow: jest.fn().mockReturnValue('secret'),
    } as unknown as ConfigService;
    const guard = new AuthGuard(jwtService, configService);

    const request: { headers: { authorization: string }; user?: unknown } = {
      headers: { authorization: 'Bearer token' },
    };
    const context = {
      switchToHttp: () => ({ getRequest: () => request }),
    } as never;

    expect(guard.canActivate(context)).toBe(true);
    expect(request.user).toEqual(payload);
  });
});
