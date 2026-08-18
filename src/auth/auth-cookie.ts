import { ConfigService } from '@nestjs/config';
import type { Request, Response } from 'express';

const REFRESH_COOKIE_NAME = 'home_pro_refresh_token';

function parseDurationToMs(value: string) {
  const normalized = value.trim().toLowerCase();
  const match = normalized.match(/^(\d+)(ms|s|m|h|d)?$/);

  if (!match) {
    throw new Error(`Unsupported duration value: ${value}`);
  }

  const amount = Number.parseInt(match[1], 10);
  const unit = match[2] ?? 'ms';

  switch (unit) {
    case 'ms':
      return amount;
    case 's':
      return amount * 1000;
    case 'm':
      return amount * 60 * 1000;
    case 'h':
      return amount * 60 * 60 * 1000;
    case 'd':
      return amount * 24 * 60 * 60 * 1000;
    default:
      throw new Error(`Unsupported duration unit: ${unit}`);
  }
}

function getRefreshCookieOptions(configService: ConfigService) {
  const isProduction = configService.get<string>('NODE_ENV') === 'production';

  return {
    httpOnly: true,
    secure: isProduction,
    sameSite: 'lax',
    path: '/',
    maxAge: parseDurationToMs(
      configService.getOrThrow<string>('JWT_REFRESH_TTL'),
    ),
  } as const;
}

export function setRefreshTokenCookie(
  response: Response,
  configService: ConfigService,
  refreshToken: string,
) {
  response.cookie(
    REFRESH_COOKIE_NAME,
    refreshToken,
    getRefreshCookieOptions(configService),
  );
}

export function clearRefreshTokenCookie(
  response: Response,
  configService: ConfigService,
) {
  response.clearCookie(
    REFRESH_COOKIE_NAME,
    getRefreshCookieOptions(configService),
  );
}

export function extractRefreshTokenFromRequest(request: Request) {
  const header = request.headers.cookie;

  if (!header) {
    return null;
  }

  for (const part of header.split(';')) {
    const [rawName, ...rest] = part.trim().split('=');
    if (rawName !== REFRESH_COOKIE_NAME) {
      continue;
    }

    return decodeURIComponent(rest.join('='));
  }

  return null;
}
