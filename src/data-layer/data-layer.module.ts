import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Customer, CustomerSchema } from '../customers/schemas/customer.schema';
import { Vehicle, VehicleSchema } from '../vehicles/schemas/vehicle.schema';
import {
  AuditLog,
  AuditLogSchema,
} from '../audit-logs/schemas/audit-log.schema';
import { User, UserSchema } from '../users/schemas/user.schema';
import {
  ServiceCatalog,
  ServiceCatalogSchema,
} from '../service-catalog/schemas/service-catalog.schema';
import { Job, JobSchema } from '../jobs/schemas/job.schema';
import { JobPart, JobPartSchema } from '../jobs/schemas/job-part.schema';
import {
  JobService,
  JobServiceSchema,
} from '../jobs/schemas/job-service.schema';
import {
  JobInvoiceSnapshot,
  JobInvoiceSnapshotSchema,
} from '../jobs/schemas/job-invoice-snapshot.schema';
import {
  JobInvoiceDispatch,
  JobInvoiceDispatchSchema,
} from '../jobs/schemas/job-invoice-dispatch.schema';
import {
  AppSettings,
  AppSettingsSchema,
} from '../settings/schemas/app-settings.schema';
import { JobDomainService } from '../jobs/job-domain.service';
import { DataLayerService } from './data-layer.service';

@Module({
  imports: [
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
  providers: [JobDomainService, DataLayerService],
  exports: [MongooseModule, DataLayerService],
})
export class DataLayerModule {}
