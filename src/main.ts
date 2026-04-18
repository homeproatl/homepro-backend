import { NestFactory } from '@nestjs/core';
import { Logger, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { NextFunction, Request, Response } from 'express';
import { AppModule } from './app.module';
import {
  enableTrustedProxy,
  getAllowedFrontendOrigins,
} from './config/frontend-origin';

async function bootstrap() {
  const logger = new Logger('Bootstrap');
  const app = await NestFactory.create(AppModule);
  const configService = app.get(ConfigService);
  const allowedOrigins = getAllowedFrontendOrigins(configService);

  enableTrustedProxy(app);
  app.use((request: Request, response: Response, next: NextFunction) => {
    response.setHeader(
      'Content-Security-Policy',
      "default-src 'none'; frame-ancestors 'none'; base-uri 'none'",
    );
    response.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
    response.setHeader('Cross-Origin-Resource-Policy', 'same-site');
    response.setHeader('Origin-Agent-Cluster', '?1');
    response.setHeader(
      'Permissions-Policy',
      'camera=(), microphone=(), geolocation=()',
    );
    response.setHeader('Referrer-Policy', 'no-referrer');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('X-Frame-Options', 'DENY');

    const forwardedProto = request.headers['x-forwarded-proto'];
    const isSecure =
      request.secure ||
      forwardedProto === 'https' ||
      (Array.isArray(forwardedProto) && forwardedProto.includes('https'));

    if (isSecure) {
      response.setHeader(
        'Strict-Transport-Security',
        'max-age=31536000; includeSubDomains',
      );
    }

    next();
  });

  app.enableCors({
    origin: (
      origin: string | undefined,
      callback: (error: Error | null, allow?: boolean) => void,
    ) => {
      callback(null, !origin || allowedOrigins.has(origin));
    },
    methods: ['GET', 'HEAD', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    credentials: true,
  });
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: true,
    }),
  );

  const port = configService.getOrThrow<number>('APP_PORT');
  try {
    await app.listen(port);
  } catch (error: unknown) {
    const code =
      typeof error === 'object' && error !== null && 'code' in error
        ? String((error as { code?: unknown }).code)
        : null;

    if (code === 'EADDRINUSE') {
      logger.error(
        `Port ${port} is already in use. Stop the running backend process or set a different APP_PORT before retrying.`,
      );
      process.exitCode = 1;
      await app.close();
      return;
    }

    throw error;
  }

  const appUrl = await app.getUrl();
  logger.log(`Rico backend listening on ${appUrl}`);
  logger.log(`Health check available at ${appUrl}/health`);
  logger.log(
    `Allowed frontend origins: ${Array.from(allowedOrigins).join(', ')}`,
  );
}
void bootstrap();
