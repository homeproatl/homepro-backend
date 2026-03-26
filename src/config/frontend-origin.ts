import type { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Request } from 'express';

type ExpressLikeWithSet = {
  set(setting: 'trust proxy', value: number): void;
};

function hasSetMethod(value: unknown): value is ExpressLikeWithSet {
  if (
    (typeof value !== 'object' && typeof value !== 'function') ||
    value === null
  ) {
    return false;
  }

  return (
    'set' in value && typeof (value as { set?: unknown }).set === 'function'
  );
}

function normalizeOrigin(value: string) {
  try {
    return new URL(value).origin;
  } catch {
    return null;
  }
}

export function getAllowedFrontendOrigins(configService: ConfigService) {
  return new Set(
    [
      configService.get<string>('FRONTEND_ORIGIN'),
      'http://127.0.0.1:3000',
      'http://localhost:3000',
    ].filter((value): value is string => Boolean(value)),
  );
}

export function getRequestOrigin(request: Request) {
  const originHeader = request.headers.origin;
  const refererHeader = request.headers.referer;

  if (typeof originHeader === 'string') {
    return normalizeOrigin(originHeader);
  }

  if (typeof refererHeader === 'string') {
    return normalizeOrigin(refererHeader);
  }

  return null;
}

export function enableTrustedProxy(app: INestApplication) {
  const httpAdapterInstance = app.getHttpAdapter().getInstance() as unknown;

  if (hasSetMethod(httpAdapterInstance)) {
    httpAdapterInstance.set('trust proxy', 1);
  }
}
