import {
  Controller,
  ExecutionContext,
  ForbiddenException,
  Get,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { UserRole } from '../../common/enums/user-role.enum';
import { Roles } from '../decorators/roles.decorator';
import { AuthGuard } from './auth.guard';
import { RolesGuard } from './roles.guard';

@Controller('guard-test')
@UseGuards(AuthGuard, RolesGuard)
class GuardTestController {
  @Get('auth-only')
  authOnly() {
    return { ok: true };
  }

  @Get('admin-only')
  @Roles(UserRole.SUPER_ADMIN)
  adminOnly() {
    return { ok: true };
  }
}

type RequestShape = {
  headers: {
    authorization?: string;
  };
  user?: {
    sub: string;
    email: string;
    role: UserRole;
    type: 'access' | 'refresh';
  };
};

function getControllerHandler(
  name: 'authOnly' | 'adminOnly',
): () => { ok: boolean } {
  const descriptor = Object.getOwnPropertyDescriptor(
    GuardTestController.prototype,
    name,
  );

  if (!descriptor || typeof descriptor.value !== 'function') {
    throw new Error(`Handler ${name} is not available on GuardTestController`);
  }

  return descriptor.value as () => { ok: boolean };
}

function createContext(
  request: RequestShape,
  handler: () => { ok: boolean },
): ExecutionContext {
  return {
    getHandler: () => handler,
    getClass: () => GuardTestController,
    switchToHttp: () => ({
      getRequest: () => request,
    }),
  } as unknown as ExecutionContext;
}

describe('Auth + Roles guards (integration)', () => {
  const jwtServiceMock = {
    verify: jest.fn((token: string) => {
      if (token === 'valid-admin-token') {
        return {
          sub: '507f1f77bcf86cd799439011',
          email: 'rico@admin.com',
          role: UserRole.SUPER_ADMIN,
          type: 'access' as const,
        };
      }

      if (token === 'valid-admin-user-token') {
        return {
          sub: '507f1f77bcf86cd799439012',
          email: 'admin@rico.com',
          role: UserRole.ADMIN,
          type: 'access' as const,
        };
      }

      throw new Error('invalid token');
    }),
  } as unknown as JwtService;

  const configService = {
    getOrThrow: jest.fn().mockReturnValue('test-access-secret'),
  } as unknown as ConfigService;

  const authGuard = new AuthGuard(jwtServiceMock, configService);
  const rolesGuard = new RolesGuard(new Reflector());

  it('returns 401 for missing auth token on protected route', () => {
    const request: RequestShape = { headers: {} };
    const context = createContext(request, getControllerHandler('authOnly'));

    expect(() => authGuard.canActivate(context)).toThrow(UnauthorizedException);
  });

  it('returns 401 for invalid auth token on protected route', () => {
    const request: RequestShape = {
      headers: { authorization: 'Bearer invalid-token' },
    };
    const context = createContext(request, getControllerHandler('authOnly'));

    expect(() => authGuard.canActivate(context)).toThrow(UnauthorizedException);
  });

  it('returns true for valid auth token on auth-only route', () => {
    const request: RequestShape = {
      headers: { authorization: 'Bearer valid-admin-user-token' },
    };
    const context = createContext(request, getControllerHandler('authOnly'));

    expect(authGuard.canActivate(context)).toBe(true);
    expect(rolesGuard.canActivate(context)).toBe(true);
    expect(request.user?.role).toBe(UserRole.ADMIN);
  });

  it('returns 403 when user role is insufficient', () => {
    const request: RequestShape = {
      headers: { authorization: 'Bearer valid-admin-user-token' },
    };
    const context = createContext(request, getControllerHandler('adminOnly'));

    expect(authGuard.canActivate(context)).toBe(true);
    expect(() => rolesGuard.canActivate(context)).toThrow(ForbiddenException);
  });

  it('returns true when role requirement is satisfied', () => {
    const request: RequestShape = {
      headers: { authorization: 'Bearer valid-admin-token' },
    };
    const context = createContext(request, getControllerHandler('adminOnly'));

    expect(authGuard.canActivate(context)).toBe(true);
    expect(rolesGuard.canActivate(context)).toBe(true);
    expect(request.user?.role).toBe(UserRole.SUPER_ADMIN);
  });
});
