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
import { EstimatesController } from './estimates.controller';
import { EstimatesService } from './estimates.service';
import { EstimateDomainModule } from './estimate-domain.module';
import { EstimateDataService } from './estimate-data.service';
import { EstimateInvoiceService } from './estimate-invoice.service';
import { Estimate, EstimateSchema } from './schemas/estimate.schema';
import {
  EstimateInvoiceDispatch,
  EstimateInvoiceDispatchSchema,
} from './schemas/estimate-invoice-dispatch.schema';
import {
  EstimateInvoiceSnapshot,
  EstimateInvoiceSnapshotSchema,
} from './schemas/estimate-invoice-snapshot.schema';

@Module({
  imports: [
    AuthModule,
    EstimateDomainModule,
    MongooseModule.forFeature([
      { name: Customer.name, schema: CustomerSchema },
      { name: Vehicle.name, schema: VehicleSchema },
      { name: Estimate.name, schema: EstimateSchema },
      { name: EstimateInvoiceSnapshot.name, schema: EstimateInvoiceSnapshotSchema },
      { name: EstimateInvoiceDispatch.name, schema: EstimateInvoiceDispatchSchema },
      { name: AppSettings.name, schema: AppSettingsSchema },
      { name: AuditLog.name, schema: AuditLogSchema },
      { name: User.name, schema: UserSchema },
      { name: ServiceCatalog.name, schema: ServiceCatalogSchema },
    ]),
  ],
  controllers: [EstimatesController],
  providers: [EstimatesService, EstimateDataService, EstimateInvoiceService],
  exports: [EstimatesService],
})
export class EstimatesModule {}
