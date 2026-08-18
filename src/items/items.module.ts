import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { AuthModule } from '../auth/auth.module';
import {
  OrgDocument,
  OrgDocumentSchema,
} from '../documents/schemas/document.schema';
import { TaxRate, TaxRateSchema } from '../documents/schemas/tax-rate.schema';
import { Item, ItemSchema } from './schemas/item.schema';
import { ItemsController } from './items.controller';
import { ItemsService } from './items.service';

@Module({
  imports: [
    AuthModule,
    MongooseModule.forFeature([
      { name: Item.name, schema: ItemSchema },
      { name: OrgDocument.name, schema: OrgDocumentSchema },
      { name: TaxRate.name, schema: TaxRateSchema },
    ]),
  ],
  controllers: [ItemsController],
  providers: [ItemsService],
  exports: [ItemsService, MongooseModule],
})
export class ItemsModule {}
