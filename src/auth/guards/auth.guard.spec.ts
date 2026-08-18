import { UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { UsersService } from '../../users/users.service';
import { OrganizationsService } from '../../organizations/organizations.service';
import { UserRole } from '../../common/enums/user-role.enum';
import { AuthGuard, assertActorOrganization } from './auth.guard';
import { JWT_ALGORITHM, JWT_AUDIENCE, JWT_ISSUER } from '../auth.constants';

const ORG_ID = '507f1f77bcf86cd7994390aa';
const USER_ID = '507f1f77bcf86cd799439011';

function buildOrganizationsService(
  overrides: Partial<OrganizationsService> = {},
): OrganizationsService {
  return {
    requireActiveOrganization: jest.fn().mockResolvedValue({
      _id: ORG_ID,
      is_active: true,
      name: 'Home Pro',
      normalized_slug: 'joseph-company',
    }),
    ...overrides,
  } as unknown as OrganizationsService;
}

describe('AuthGuard', () => {
  it('rejects requests without bearer token', async () => {
    const jwtService = { verify: jest.fn() } as unknown as JwtService;
    const configService = {
      getOrThrow: jest.fn().mockReturnValue('secret'),
    } as unknown as ConfigService;
    const usersService = {
      findById: jest.fn(),
    } as unknown as UsersService;
    const guard = new AuthGuard(
      jwtService,
      configService,
      usersService,
      buildOrganizationsService(),
    );

    const request = { headers: {} };
    const context = {
      switchToHttp: () => ({ getRequest: () => request }),
    } as never;

    await expect(guard.canActivate(context)).rejects.toThrow(
      UnauthorizedException,
    );
  });

  it('accepts valid access token and populates request actor from DB user', async () => {
    const payload = {
      sub: USER_ID,
      email: 'stale@admin.com',
      role: 'TECHNICIAN',
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
        _id: USER_ID,
        id: USER_ID,
        email: 'joseph@admin.com',
        name: 'Home Pro',
        role: UserRole.ADMIN,
        is_active: true,
        token_version: 3,
        organization_id: ORG_ID,
      }),
    } as unknown as UsersService;
    const organizationsService = buildOrganizationsService();
    const guard = new AuthGuard(
      jwtService,
      configService,
      usersService,
      organizationsService,
    );

    const request: {
      headers: { authorization: string };
      user?: unknown;
      actor?: unknown;
    } = {
      headers: { authorization: 'Bearer token' },
    };
    const context = {
      switchToHttp: () => ({ getRequest: () => request }),
    } as never;

    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(jwtService.verify).toHaveBeenCalledWith('token', {
      secret: 'secret',
      algorithms: [JWT_ALGORITHM],
      issuer: JWT_ISSUER,
      audience: JWT_AUDIENCE,
    });
    expect(request.actor).toEqual({
      user_id: USER_ID,
      organization_id: ORG_ID,
      role: UserRole.ADMIN,
      email: 'joseph@admin.com',
      name: 'Home Pro',
    });
    expect(request).not.toHaveProperty('user');
  });

  it('rejects users missing company ownership', async () => {
    const payload = {
      sub: USER_ID,
      email: 'joseph@admin.com',
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
        _id: USER_ID,
        is_active: true,
        token_version: 1,
        organization_id: null,
        role: UserRole.ADMIN,
        email: 'joseph@admin.com',
        name: 'Home Pro',
      }),
    } as unknown as UsersService;
    const guard = new AuthGuard(
      jwtService,
      configService,
      usersService,
      buildOrganizationsService(),
    );

    const request = { headers: { authorization: 'Bearer token' } };
    const context = {
      switchToHttp: () => ({ getRequest: () => request }),
    } as never;

    await expect(guard.canActivate(context)).rejects.toThrow(
      UnauthorizedException,
    );
  });

  it('rejects tokens that were issued before logout incremented token version', async () => {
    const payload = {
      sub: USER_ID,
      email: 'joseph@admin.com',
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
        organization_id: ORG_ID,
        role: UserRole.ADMIN,
        email: 'joseph@admin.com',
        name: 'Home Pro',
      }),
    } as unknown as UsersService;
    const guard = new AuthGuard(
      jwtService,
      configService,
      usersService,
      buildOrganizationsService(),
    );

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

  it('rejects request-supplied organization ids that differ from actor scope', () => {
    expect(() =>
      assertActorOrganization(
        {
          user_id: USER_ID,
          organization_id: ORG_ID,
          role: UserRole.ADMIN,
          email: 'a@b.com',
          name: 'A',
        },
        '507f1f77bcf86cd7994390bb',
      ),
    ).toThrow(UnauthorizedException);
  });

  it('rejects body organization_id that differs from actor company on live requests', async () => {
    const jwtService = {
      verify: jest.fn().mockReturnValue({
        sub: USER_ID,
        email: 'joseph@admin.com',
        role: UserRole.ADMIN,
        type: 'access',
        token_version: 1,
      }),
    } as unknown as JwtService;
    const configService = {
      getOrThrow: jest.fn().mockReturnValue('access-secret'),
    } as unknown as ConfigService;
    const usersService = {
      findById: jest.fn().mockResolvedValue({
        _id: USER_ID,
        id: USER_ID,
        is_active: true,
        token_version: 1,
        organization_id: ORG_ID,
        role: UserRole.ADMIN,
        email: 'joseph@admin.com',
        name: 'Home Pro',
      }),
    } as unknown as UsersService;
    const guard = new AuthGuard(
      jwtService,
      configService,
      usersService,
      buildOrganizationsService(),
    );

    const request = {
      headers: { authorization: 'Bearer valid-token' },
      body: { organization_id: '507f1f77bcf86cd7994390bb' },
      query: {},
    };
    const context = {
      switchToHttp: () => ({ getRequest: () => request }),
    } as never;

    await expect(guard.canActivate(context)).rejects.toThrow(
      UnauthorizedException,
    );
  });
});
