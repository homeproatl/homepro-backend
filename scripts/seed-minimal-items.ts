import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { OrganizationsService } from '../src/organizations/organizations.service';
import { ItemsService } from '../src/items/items.service';

async function bootstrap() {
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn', 'log'],
  });

  try {
    const organizationsService = app.get(OrganizationsService);
    const itemsService = app.get(ItemsService);
    const organization = await organizationsService.ensureFixedCompany();
    const organizationId = String(organization._id);

    await itemsService.ensureMinimalCatalog(organizationId);
    // eslint-disable-next-line no-console
    console.log('Minimal contractor items catalog ready');
  } finally {
    await app.close();
  }
}

void bootstrap();
