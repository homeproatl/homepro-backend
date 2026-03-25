import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { AuthModule } from '../auth/auth.module';
import { JobService, JobServiceSchema } from '../jobs/schemas/job-service.schema';
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
      { name: JobService.name, schema: JobServiceSchema },
    ]),
  ],
  controllers: [ServiceCatalogController],
  providers: [ServiceCatalogService],
  exports: [ServiceCatalogService, MongooseModule],
})
export class ServiceCatalogModule {}
