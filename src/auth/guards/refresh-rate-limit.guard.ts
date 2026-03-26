import {
  CanActivate,
  ExecutionContext,
  HttpException,
  HttpStatus,
  Injectable,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { AuthRateLimitService } from '../auth-rate-limit.service';

function getClientIp(request: Request) {
  return request.ip || request.socket.remoteAddress || 'unknown';
}

@Injectable()
export class RefreshRateLimitGuard implements CanActivate {
  constructor(private readonly authRateLimitService: AuthRateLimitService) {}

  async canActivate(context: ExecutionContext) {
    const request = context.switchToHttp().getRequest<Request>();
    const response = context.switchToHttp().getResponse<Response>();
    const retryAfter = await this.authRateLimitService.consume(
      `auth-refresh-ip:${getClientIp(request)}`,
      30,
      5 * 60 * 1000,
    );

    if (retryAfter) {
      response.setHeader('Retry-After', retryAfter.toString());
      throw new HttpException(
        'Too many refresh attempts. Please try again shortly.',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    return true;
  }
}
