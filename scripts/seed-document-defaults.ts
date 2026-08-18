import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { ContractTemplatesService } from '../src/documents/contract-templates.service';
import { TaxRatesService } from '../src/documents/tax-rates.service';
import { OrganizationsService } from '../src/organizations/organizations.service';

/**
 * Seeds organization-scoped default tax rate + contract template.
 * Idempotent; safe to run repeatedly.
 */
async function bootstrap() {
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn', 'log'],
  });

  try {
    const organizationsService = app.get(OrganizationsService);
    const taxRatesService = app.get(TaxRatesService);
    const contractTemplatesService = app.get(ContractTemplatesService);
    const organization = await organizationsService.ensureFixedCompany();
    const organizationId = String(organization._id);

    const tax = await taxRatesService.ensureDefaultTaxRate(organizationId);
    const contract =
      await contractTemplatesService.ensureDefaultContractTemplate(
        organizationId,
      );

    // eslint-disable-next-line no-console
    console.log(
      `Document defaults ready: tax=${tax.name} (${tax.rate_basis_points} bps), contract=${contract.name}`,
    );
  } finally {
    await app.close();
  }
}

void bootstrap();
