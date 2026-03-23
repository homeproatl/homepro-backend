import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { ServiceCatalogService } from '../src/service-catalog/service-catalog.service';

async function bootstrap() {
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn', 'log'],
  });

  try {
    const serviceCatalogService = app.get(ServiceCatalogService);
    await serviceCatalogService.ensureMinimalCatalog();
    // eslint-disable-next-line no-console
    console.log('Minimal service catalog ready');
  } finally {
    await app.close();
  }
}

void bootstrap();
