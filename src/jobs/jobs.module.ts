import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { AuthModule } from '../auth/auth.module';
import {
  AuditLog,
  AuditLogSchema,
} from '../audit-logs/schemas/audit-log.schema';
import { Customer, CustomerSchema } from '../customers/schemas/customer.schema';
import {
  ServiceCatalog,
  ServiceCatalogSchema,
} from '../service-catalog/schemas/service-catalog.schema';
import {
  AppSettings,
  AppSettingsSchema,
} from '../settings/schemas/app-settings.schema';
import { User, UserSchema } from '../users/schemas/user.schema';
import { Vehicle, VehicleSchema } from '../vehicles/schemas/vehicle.schema';
import { JobsController } from './jobs.controller';
import { JobsService } from './jobs.service';
import { JobDomainModule } from './job-domain.module';
import { JobDataService } from './job-data.service';
import { JobInvoiceService } from './job-invoice.service';
import { Job, JobSchema } from './schemas/job.schema';
import {
  JobInvoiceDispatch,
  JobInvoiceDispatchSchema,
} from './schemas/job-invoice-dispatch.schema';
import {
  JobInvoiceSnapshot,
  JobInvoiceSnapshotSchema,
} from './schemas/job-invoice-snapshot.schema';
import { JobPart, JobPartSchema } from './schemas/job-part.schema';
import { JobService, JobServiceSchema } from './schemas/job-service.schema';

@Module({
  imports: [
    AuthModule,
    JobDomainModule,
    MongooseModule.forFeature([
      { name: Customer.name, schema: CustomerSchema },
      { name: Vehicle.name, schema: VehicleSchema },
      { name: Job.name, schema: JobSchema },
      { name: JobPart.name, schema: JobPartSchema },
      { name: JobService.name, schema: JobServiceSchema },
      { name: JobInvoiceSnapshot.name, schema: JobInvoiceSnapshotSchema },
      { name: JobInvoiceDispatch.name, schema: JobInvoiceDispatchSchema },
      { name: AppSettings.name, schema: AppSettingsSchema },
      { name: AuditLog.name, schema: AuditLogSchema },
      { name: User.name, schema: UserSchema },
      { name: ServiceCatalog.name, schema: ServiceCatalogSchema },
    ]),
  ],
  controllers: [JobsController],
  providers: [JobsService, JobDataService, JobInvoiceService],
  exports: [JobsService],
})
export class JobsModule {}
