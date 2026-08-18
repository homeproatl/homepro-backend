import { Module, forwardRef } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { AuthModule } from '../auth/auth.module';
import {
  AuditLog,
  AuditLogSchema,
} from '../audit-logs/schemas/audit-log.schema';
import { DocumentsModule } from '../documents/documents.module';
import { Client, ClientSchema } from '../clients/schemas/client.schema';
import {
  DocumentAutomationJob,
  DocumentAutomationJobSchema,
} from '../documents/schemas/document-automation-job.schema';
import {
  OrgDocument,
  OrgDocumentSchema,
} from '../documents/schemas/document.schema';
import { DocumentAutomationJobService } from '../documents/document-automation-job.service';
import { SettingsModule } from '../settings/settings.module';
import { AssetsModule } from '../assets/assets.module';
import { EstimateConversionService } from './estimate-conversion.service';
import { InvoiceWorkflowService } from './invoice-workflow.service';
import { InvoicesController } from './invoices.controller';
import { InvoicesService } from './invoices.service';
import { PaymentsController } from './payments.controller';
import { PaymentsService } from './payments.service';
import { PublicInvoicePaymentsController } from './public-invoice-payments.controller';
import { StripePaymentsService } from './stripe-payments.service';
import { PaymentNotificationService } from './payment-notification.service';
import { StripeWebhookController } from './stripe-webhook.controller';
import { Payment, PaymentSchema } from './schemas/payment.schema';
import {
  PaymentLedgerEntry,
  PaymentLedgerEntrySchema,
} from './schemas/payment-ledger-entry.schema';
import {
  PaymentCustomerProfile,
  PaymentCustomerProfileSchema,
} from './schemas/payment-customer-profile.schema';
import {
  StripeEventInbox,
  StripeEventInboxSchema,
} from './schemas/stripe-event-inbox.schema';

@Module({
  imports: [
    AuthModule,
    SettingsModule,
    AssetsModule,
    forwardRef(() => DocumentsModule),
    MongooseModule.forFeature([
      { name: OrgDocument.name, schema: OrgDocumentSchema },
      { name: Client.name, schema: ClientSchema },
      { name: Payment.name, schema: PaymentSchema },
      { name: PaymentLedgerEntry.name, schema: PaymentLedgerEntrySchema },
      {
        name: PaymentCustomerProfile.name,
        schema: PaymentCustomerProfileSchema,
      },
      { name: StripeEventInbox.name, schema: StripeEventInboxSchema },
      { name: AuditLog.name, schema: AuditLogSchema },
      {
        name: DocumentAutomationJob.name,
        schema: DocumentAutomationJobSchema,
      },
    ]),
  ],
  controllers: [
    InvoicesController,
    PaymentsController,
    PublicInvoicePaymentsController,
    StripeWebhookController,
  ],
  providers: [
    InvoicesService,
    InvoiceWorkflowService,
    EstimateConversionService,
    PaymentsService,
    StripePaymentsService,
    PaymentNotificationService,
    DocumentAutomationJobService,
  ],
  exports: [
    InvoicesService,
    InvoiceWorkflowService,
    EstimateConversionService,
    PaymentsService,
    StripePaymentsService,
    DocumentAutomationJobService,
  ],
})
export class InvoicesModule {}
