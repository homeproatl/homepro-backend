import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { AuthModule } from '../auth/auth.module';
import {
  OrgDocument,
  OrgDocumentSchema,
} from '../documents/schemas/document.schema';
import {
  PaymentLedgerEntry,
  PaymentLedgerEntrySchema,
} from '../invoices/schemas/payment-ledger-entry.schema';
import { SettingsModule } from '../settings/settings.module';
import { DashboardController } from './dashboard.controller';
import { DashboardService } from './dashboard.service';
import { ReportsController } from './reports.controller';

@Module({
  imports: [
    AuthModule,
    SettingsModule,
    MongooseModule.forFeature([
      { name: OrgDocument.name, schema: OrgDocumentSchema },
      { name: PaymentLedgerEntry.name, schema: PaymentLedgerEntrySchema },
    ]),
  ],
  controllers: [DashboardController, ReportsController],
  providers: [DashboardService],
  exports: [DashboardService],
})
export class DashboardModule {}
