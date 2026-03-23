import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { DataLayerModule } from '../data-layer/data-layer.module';
import { AuthGuard } from '../auth/guards/auth.guard';
import { JobsController } from './jobs.controller';
import { JobsService } from './jobs.service';
import { JobDomainService } from './job-domain.service';
import { JobInvoiceService } from './job-invoice.service';

@Module({
  imports: [ConfigModule, JwtModule.register({}), DataLayerModule],
  controllers: [JobsController],
  providers: [JobsService, JobDomainService, JobInvoiceService, AuthGuard],
  exports: [JobsService],
})
export class JobsModule {}
