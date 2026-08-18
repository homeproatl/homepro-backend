import { Module, forwardRef } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { AuthModule } from '../auth/auth.module';
import { AssetsModule } from '../assets/assets.module';
import { Client, ClientSchema } from '../clients/schemas/client.schema';
import { Item, ItemSchema } from '../items/schemas/item.schema';
import {
  Organization,
  OrganizationSchema,
} from '../organizations/schemas/organization.schema';
import {
  AppSettings,
  AppSettingsSchema,
} from '../settings/schemas/app-settings.schema';
import { SettingsModule } from '../settings/settings.module';
import { ContractTemplatesService } from './contract-templates.service';
import { DocumentAccessGrantsService } from './document-access-grants.service';
import { DocumentEmailOutboxService } from './document-email-outbox.service';
import { DocumentNumbersService } from './document-numbers.service';
import { DocumentPdfService } from './document-pdf.service';
import { DocumentPresentationService } from './document-presentation.service';
import { DocumentsController } from './documents.controller';
import { DocumentsService } from './documents.service';
import { PublicEstimateRateLimitGuard } from './public-estimate-rate-limit.guard';
import { PublicEstimatesController } from './public-estimates.controller';
import { PublicInvoicesController } from './public-invoices.controller';
import { TaxRatesController } from './tax-rates.controller';
import { TaxRatesService } from './tax-rates.service';
import {
  ContractTemplate,
  ContractTemplateSchema,
} from './schemas/contract-template.schema';
import {
  DocumentAccessGrant,
  DocumentAccessGrantSchema,
} from './schemas/document-access-grant.schema';
import {
  DocumentEmailOutbox,
  DocumentEmailOutboxSchema,
} from './schemas/document-email-outbox.schema';
import {
  DocumentEvent,
  DocumentEventSchema,
} from './schemas/document-event.schema';
import {
  DocumentNumberCounter,
  DocumentNumberCounterSchema,
} from './schemas/document-number-counter.schema';
import { OrgDocument, OrgDocumentSchema } from './schemas/document.schema';
import {
  SignatureEvidence,
  SignatureEvidenceSchema,
} from './schemas/signature-evidence.schema';
import { TaxRate, TaxRateSchema } from './schemas/tax-rate.schema';
import { Payment, PaymentSchema } from '../invoices/schemas/payment.schema';

@Module({
  imports: [
    AuthModule,
    AssetsModule,
    forwardRef(() => SettingsModule),
    MongooseModule.forFeature([
      { name: OrgDocument.name, schema: OrgDocumentSchema },
      { name: DocumentEvent.name, schema: DocumentEventSchema },
      { name: DocumentNumberCounter.name, schema: DocumentNumberCounterSchema },
      { name: TaxRate.name, schema: TaxRateSchema },
      { name: ContractTemplate.name, schema: ContractTemplateSchema },
      { name: DocumentAccessGrant.name, schema: DocumentAccessGrantSchema },
      { name: SignatureEvidence.name, schema: SignatureEvidenceSchema },
      { name: DocumentEmailOutbox.name, schema: DocumentEmailOutboxSchema },
      { name: Client.name, schema: ClientSchema },
      { name: Item.name, schema: ItemSchema },
      { name: Organization.name, schema: OrganizationSchema },
      { name: AppSettings.name, schema: AppSettingsSchema },
      { name: Payment.name, schema: PaymentSchema },
    ]),
  ],
  controllers: [
    DocumentsController,
    TaxRatesController,
    PublicEstimatesController,
    PublicInvoicesController,
  ],
  providers: [
    DocumentsService,
    DocumentNumbersService,
    TaxRatesService,
    ContractTemplatesService,
    DocumentAccessGrantsService,
    DocumentEmailOutboxService,
    DocumentPdfService,
    DocumentPresentationService,
    PublicEstimateRateLimitGuard,
  ],
  exports: [
    DocumentsService,
    DocumentNumbersService,
    TaxRatesService,
    ContractTemplatesService,
    DocumentAccessGrantsService,
    DocumentEmailOutboxService,
    DocumentPdfService,
    DocumentPresentationService,
    PublicEstimateRateLimitGuard,
    MongooseModule,
  ],
})
export class DocumentsModule {}
