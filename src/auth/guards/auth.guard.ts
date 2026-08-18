import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { Request } from 'express';
import { UsersService } from '../../users/users.service';
import { OrganizationsService } from '../../organizations/organizations.service';
import { UserRole } from '../../common/enums/user-role.enum';
import { AuthActor } from '../../common/types/auth-actor';
import {
  assertActorOrganization,
  readRequestOrganizationId,
} from '../../common/utils/organization-scope';
import { JWT_ALGORITHM, JWT_AUDIENCE, JWT_ISSUER } from '../auth.constants';

type JwtPayload = {
  sub: string;
  email: string;
  role: string;
  type: 'access' | 'refresh';
  token_version?: number;
};

export type AuthenticatedRequest = Request & {
  actor?: AuthActor;
};

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
    private readonly usersService: UsersService,
    private readonly organizationsService: OrganizationsService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const token = this.extractToken(request);

    if (!token) {
      throw new UnauthorizedException('Missing access token');
    }

    try {
      const payload = this.jwtService.verify<JwtPayload>(token, {
        secret: this.configService.getOrThrow<string>('JWT_ACCESS_SECRET'),
        algorithms: [JWT_ALGORITHM],
        issuer: JWT_ISSUER,
        audience: JWT_AUDIENCE,
      });

      if (payload.type !== 'access') {
        throw new UnauthorizedException('Invalid access token');
      }

      const user = await this.usersService.findById(payload.sub);
      const userTokenVersion = user?.token_version ?? 0;
      const payloadTokenVersion = payload.token_version ?? 0;

      if (
        !user ||
        !user.is_active ||
        userTokenVersion !== payloadTokenVersion
      ) {
        throw new UnauthorizedException('Invalid access token');
      }

      if (!user.organization_id) {
        throw new UnauthorizedException('Company ownership is missing');
      }

      const organization =
        await this.organizationsService.requireActiveOrganization(
          String(user.organization_id),
        );

      const actor: AuthActor = {
        user_id: String(user._id),
        organization_id: String(organization._id),
        role: user.role,
        email: user.email,
        name: user.name,
      };

      // Role/email always come from the database user record, never request body.
      request.actor = actor;
      // Reject request-supplied organization_id overrides from body or query.
      assertActorOrganization(
        actor,
        readRequestOrganizationId(request.body) ??
          readRequestOrganizationId(request.query),
      );
      return true;
    } catch (error) {
      if (error instanceof UnauthorizedException) {
        throw error;
      }
      throw new UnauthorizedException('Invalid access token');
    }
  }

  private extractToken(request: Request): string | null {
    const header = request.headers.authorization;

    if (!header?.startsWith('Bearer ')) {
      return null;
    }

    return header.slice(7);
  }
}

export { assertActorOrganization } from '../../common/utils/organization-scope';

export function isAdminActor(actor: AuthActor): boolean {
  return actor.role === UserRole.ADMIN;
}
