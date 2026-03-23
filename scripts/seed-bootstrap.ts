import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { UsersService } from '../src/users/users.service';
import { ServiceCatalogService } from '../src/service-catalog/service-catalog.service';

async function bootstrap() {
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn', 'log'],
  });

  try {
    const usersService = app.get(UsersService);
    const serviceCatalogService = app.get(ServiceCatalogService);
    const user = await usersService.ensureSuperAdmin();
    await serviceCatalogService.ensureMinimalCatalog();
    // eslint-disable-next-line no-console
    console.log(`Bootstrap seed ready for ${user.email}`);
  } finally {
    await app.close();
  }
}

void bootstrap();
