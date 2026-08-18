import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { DocumentsModule } from '../documents/documents.module';
import { InvoicesModule } from '../invoices/invoices.module';
import { DocumentEstimatesFacade } from './document-estimates.facade';
import { EstimatesController } from './estimates.controller';

@Module({
  imports: [AuthModule, DocumentsModule, InvoicesModule],
  controllers: [EstimatesController],
  providers: [DocumentEstimatesFacade],
  exports: [DocumentEstimatesFacade],
})
export class EstimatesModule {}
