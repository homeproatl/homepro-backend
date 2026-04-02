import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { AuthModule } from '../auth/auth.module';
import { Estimate, EstimateSchema } from '../estimates/schemas/estimate.schema';
import {
  ServiceCatalog,
  ServiceCatalogSchema,
} from './schemas/service-catalog.schema';
import { ServiceCatalogService } from './service-catalog.service';
import { ServiceCatalogController } from './service-catalog.controller';

@Module({
  imports: [
    AuthModule,
    MongooseModule.forFeature([
      { name: ServiceCatalog.name, schema: ServiceCatalogSchema },
      { name: Estimate.name, schema: EstimateSchema },
    ]),
  ],
  controllers: [ServiceCatalogController],
  providers: [ServiceCatalogService],
  exports: [ServiceCatalogService, MongooseModule],
})
export class ServiceCatalogModule {}
