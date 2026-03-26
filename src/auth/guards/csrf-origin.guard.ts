import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Request } from 'express';
import {
  getAllowedFrontendOrigins,
  getRequestOrigin,
} from '../../config/frontend-origin';

@Injectable()
export class CsrfOriginGuard implements CanActivate {
  constructor(private readonly configService: ConfigService) {}

  canActivate(context: ExecutionContext) {
    const request = context.switchToHttp().getRequest<Request>();
    const origin = getRequestOrigin(request);

    if (!origin) {
      throw new ForbiddenException('Missing trusted request origin');
    }

    if (!getAllowedFrontendOrigins(this.configService).has(origin)) {
      throw new ForbiddenException('Cross-site auth request blocked');
    }

    return true;
  }
}
