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
import { JWT_ALGORITHM, JWT_AUDIENCE, JWT_ISSUER } from '../auth.constants';

type JwtPayload = {
  sub: string;
  email: string;
  role: string;
  type: 'access' | 'refresh';
  token_version?: number;
};

export type AuthenticatedRequest = Request & {
  user?: JwtPayload;
};

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
    private readonly usersService: UsersService,
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

      request.user = payload;
      return true;
    } catch {
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
