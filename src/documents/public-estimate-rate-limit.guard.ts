import {
  CanActivate,
  ExecutionContext,
  HttpException,
  HttpStatus,
  Injectable,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { AuthRateLimitService } from '../auth/auth-rate-limit.service';
import { hashAccessToken, redactToken } from './document-token.crypto';

const WINDOW_MS = 60_000;
const READ_LIMIT = 240;
const ACTION_LIMIT = 20;

@Injectable()
export class PublicEstimateRateLimitGuard implements CanActivate {
  constructor(private readonly rateLimitService: AuthRateLimitService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request>();
    const response = context.switchToHttp().getResponse<Response>();
    const ip = this.resolveIp(request);
    const token = String(request.params?.token ?? '');
    const scope = ['GET', 'HEAD'].includes(request.method.toUpperCase())
      ? 'read'
      : 'action';
    const limit = scope === 'read' ? READ_LIMIT : ACTION_LIMIT;
    const tokenFingerprint = token
      ? hashAccessToken(token).slice(0, 16)
      : 'missing';

    // Log only a redacted token form — never plaintext.
    if (token) {
      request.headers['x-redacted-estimate-token'] = redactToken(token);
    }

    const ipRetry = await this.rateLimitService.consume(
      `public-document:v2:${scope}:ip:${ip}`,
      limit,
      WINDOW_MS,
    );
    if (ipRetry != null) {
      response.setHeader('Retry-After', String(ipRetry));
      throw new HttpException(
        {
          statusCode: HttpStatus.TOO_MANY_REQUESTS,
          message: 'Too many requests',
          retry_after_seconds: ipRetry,
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    const tokenRetry = await this.rateLimitService.consume(
      `public-document:v2:${scope}:token:${tokenFingerprint}`,
      limit,
      WINDOW_MS,
    );
    if (tokenRetry != null) {
      response.setHeader('Retry-After', String(tokenRetry));
      throw new HttpException(
        {
          statusCode: HttpStatus.TOO_MANY_REQUESTS,
          message: 'Too many requests',
          retry_after_seconds: tokenRetry,
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    return true;
  }

  private resolveIp(request: Request) {
    return request.ip || request.socket.remoteAddress || 'unknown';
  }
}
