import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { AuthModule } from '../auth/auth.module';
import { Estimate, EstimateSchema } from '../estimates/schemas/estimate.schema';
import {
  ServiceCatalog,
  ServiceCatalogSchema,
} from '../service-catalog/schemas/service-catalog.schema';
import { Tag, TagSchema } from './schemas/tag.schema';
import { TagsController } from './tags.controller';
import { TagsService } from './tags.service';

@Module({
  imports: [
    AuthModule,
    MongooseModule.forFeature([
      { name: Tag.name, schema: TagSchema },
      { name: Estimate.name, schema: EstimateSchema },
      { name: ServiceCatalog.name, schema: ServiceCatalogSchema },
    ]),
  ],
  controllers: [TagsController],
  providers: [TagsService],
  exports: [TagsService, MongooseModule],
})
export class TagsModule {}
