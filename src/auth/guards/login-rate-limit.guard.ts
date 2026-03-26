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

function normalizeEmail(value: unknown) {
  return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

@Injectable()
export class LoginRateLimitGuard implements CanActivate {
  constructor(private readonly authRateLimitService: AuthRateLimitService) {}

  async canActivate(context: ExecutionContext) {
    const request = context.switchToHttp().getRequest<Request>();
    const response = context.switchToHttp().getResponse<Response>();
    const ip = getClientIp(request);
    const email = normalizeEmail(
      (request.body as { email?: unknown } | undefined)?.email,
    );

    const ipRetryAfter = await this.authRateLimitService.consume(
      `auth-login-ip:${ip}`,
      10,
      15 * 60 * 1000,
    );
    if (ipRetryAfter) {
      response.setHeader('Retry-After', ipRetryAfter.toString());
      throw new HttpException(
        'Too many login attempts. Please try again later.',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    if (!email) {
      return true;
    }

    const emailRetryAfter = await this.authRateLimitService.consume(
      `auth-login-email:${email}`,
      5,
      15 * 60 * 1000,
    );
    if (emailRetryAfter) {
      response.setHeader('Retry-After', emailRetryAfter.toString());
      throw new HttpException(
        'Too many login attempts. Please try again later.',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    return true;
  }
}
