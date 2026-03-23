import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { MongooseModule } from '@nestjs/mongoose';
import {
  ServiceCatalog,
  ServiceCatalogSchema,
} from './schemas/service-catalog.schema';
import { ServiceCatalogService } from './service-catalog.service';
import { ServiceCatalogController } from './service-catalog.controller';
import { AuthGuard } from '../auth/guards/auth.guard';

@Module({
  imports: [
    ConfigModule,
    JwtModule.register({}),
    MongooseModule.forFeature([
      { name: ServiceCatalog.name, schema: ServiceCatalogSchema },
    ]),
  ],
  controllers: [ServiceCatalogController],
  providers: [ServiceCatalogService, AuthGuard],
  exports: [ServiceCatalogService, MongooseModule],
})
export class ServiceCatalogModule {}
