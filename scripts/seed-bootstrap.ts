import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { UsersService } from '../src/users/users.service';
import { ItemsService } from '../src/items/items.service';
import { OrganizationsService } from '../src/organizations/organizations.service';
import { TaxRatesService } from '../src/documents/tax-rates.service';
import { ContractTemplatesService } from '../src/documents/contract-templates.service';

async function bootstrap() {
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn', 'log'],
  });

  try {
    const organizationsService = app.get(OrganizationsService);
    const usersService = app.get(UsersService);
    const itemsService = app.get(ItemsService);
    const taxRatesService = app.get(TaxRatesService);
    const contractTemplatesService = app.get(ContractTemplatesService);
    const organization = await organizationsService.ensureFixedCompany();
    const user = await usersService.ensureOwnerAdmin();
    const organizationId = String(organization._id);
    await itemsService.ensureMinimalCatalog(organizationId);
    await taxRatesService.ensureDefaultTaxRate(organizationId);
    await contractTemplatesService.ensureDefaultContractTemplate(
      organizationId,
    );
    // eslint-disable-next-line no-console
    console.log(
      `Bootstrap seed ready for owner admin ${user.email} under company ${organization.normalized_slug}`,
    );
  } finally {
    await app.close();
  }
}

void bootstrap();
