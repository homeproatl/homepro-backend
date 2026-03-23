import { NestFactory } from '@nestjs/core';
import { Logger, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AppModule } from './app.module';

async function bootstrap() {
  const logger = new Logger('Bootstrap');
  const app = await NestFactory.create(AppModule);
  const configService = app.get(ConfigService);
  const frontendOrigin = configService.get<string>('FRONTEND_ORIGIN');
  const allowedOrigins = new Set(
    [frontendOrigin, 'http://127.0.0.1:3000', 'http://localhost:3000'].filter(
      (value): value is string => Boolean(value),
    ),
  );

  app.enableCors({
    origin: (
      origin: string | undefined,
      callback: (error: Error | null, allow?: boolean) => void,
    ) => {
      if (!origin || allowedOrigins.has(origin)) {
        callback(null, true);
        return;
      }

      callback(new Error('Not allowed by CORS'));
    },
    methods: ['GET', 'HEAD', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'x-refresh-token'],
    credentials: false,
  });
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: true,
    }),
  );

  const port = configService.getOrThrow<number>('APP_PORT');
  await app.listen(port);

  const appUrl = await app.getUrl();
  logger.log(`Rico backend listening on ${appUrl}`);
  logger.log(`Health check available at ${appUrl}/health`);
  logger.log(
    `Allowed frontend origins: ${Array.from(allowedOrigins).join(', ')}`,
  );
}
void bootstrap();
