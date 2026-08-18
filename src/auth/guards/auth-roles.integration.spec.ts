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
import { UsersService } from '../../users/users.service';
import { OrganizationsService } from '../../organizations/organizations.service';
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
  @Roles(UserRole.ADMIN)
  adminOnly() {
    return { ok: true };
  }
}

type RequestShape = {
  headers: {
    authorization?: string;
  };
  actor?: {
    user_id: string;
    organization_id: string;
    email: string;
    role: UserRole;
    name: string;
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
          email: 'joseph@admin.com',
          role: UserRole.ADMIN,
          type: 'access' as const,
          token_version: 0,
        };
      }

      if (token === 'valid-technician-token') {
        return {
          sub: '507f1f77bcf86cd799439012',
          email: 'tech@homepro.test',
          role: UserRole.TECHNICIAN,
          type: 'access' as const,
          token_version: 0,
        };
      }

      throw new Error('invalid token');
    }),
  } as unknown as JwtService;

  const configService = {
    getOrThrow: jest.fn().mockReturnValue('test-access-secret'),
  } as unknown as ConfigService;
  const usersService = {
    findById: jest.fn((id: string) => {
      if (id === '507f1f77bcf86cd799439011') {
        return {
          _id: id,
          id,
          is_active: true,
          token_version: 0,
          organization_id: '507f1f77bcf86cd7994390aa',
          role: UserRole.ADMIN,
          email: 'joseph@admin.com',
          name: 'Home Pro',
        };
      }
      if (id === '507f1f77bcf86cd799439012') {
        return {
          _id: id,
          id,
          is_active: true,
          token_version: 0,
          organization_id: '507f1f77bcf86cd7994390aa',
          role: UserRole.TECHNICIAN,
          email: 'tech@admin.com',
          name: 'Tech',
        };
      }
      return null;
    }),
  } as unknown as UsersService;

  const organizationsService = {
    requireActiveOrganization: jest.fn().mockResolvedValue({
      _id: '507f1f77bcf86cd7994390aa',
      is_active: true,
      name: 'Home Pro',
      normalized_slug: 'joseph-company',
    }),
  } as unknown as OrganizationsService;

  const authGuard = new AuthGuard(
    jwtServiceMock,
    configService,
    usersService,
    organizationsService,
  );
  const rolesGuard = new RolesGuard(new Reflector());

  it('returns 401 for missing auth token on protected route', async () => {
    const request: RequestShape = { headers: {} };
    const context = createContext(request, getControllerHandler('authOnly'));

    await expect(authGuard.canActivate(context)).rejects.toThrow(
      UnauthorizedException,
    );
  });

  it('returns 401 for invalid auth token on protected route', async () => {
    const request: RequestShape = {
      headers: { authorization: 'Bearer invalid-token' },
    };
    const context = createContext(request, getControllerHandler('authOnly'));

    await expect(authGuard.canActivate(context)).rejects.toThrow(
      UnauthorizedException,
    );
  });

  it('returns true for valid auth token on auth-only route', async () => {
    const request: RequestShape = {
      headers: { authorization: 'Bearer valid-technician-token' },
    };
    const context = createContext(request, getControllerHandler('authOnly'));

    await expect(authGuard.canActivate(context)).resolves.toBe(true);
    expect(rolesGuard.canActivate(context)).toBe(true);
    expect(request.actor?.role).toBe(UserRole.TECHNICIAN);
  });

  it('returns 403 when user role is insufficient', async () => {
    const request: RequestShape = {
      headers: { authorization: 'Bearer valid-technician-token' },
    };
    const context = createContext(request, getControllerHandler('adminOnly'));

    await expect(authGuard.canActivate(context)).resolves.toBe(true);
    expect(() => rolesGuard.canActivate(context)).toThrow(ForbiddenException);
  });

  it('returns true when role requirement is satisfied', async () => {
    const request: RequestShape = {
      headers: { authorization: 'Bearer valid-admin-token' },
    };
    const context = createContext(request, getControllerHandler('adminOnly'));

    await expect(authGuard.canActivate(context)).resolves.toBe(true);
    expect(rolesGuard.canActivate(context)).toBe(true);
    expect(request.actor?.role).toBe(UserRole.ADMIN);
  });
});
