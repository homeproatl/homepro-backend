import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { DataLayerModule } from '../data-layer/data-layer.module';
import { JobsController } from './jobs.controller';
import { JobsService } from './jobs.service';
import { JobDomainService } from './job-domain.service';
import { JobInvoiceService } from './job-invoice.service';

@Module({
  imports: [AuthModule, DataLayerModule],
  controllers: [JobsController],
  providers: [JobsService, JobDomainService, JobInvoiceService],
  exports: [JobsService],
})
export class JobsModule {}
