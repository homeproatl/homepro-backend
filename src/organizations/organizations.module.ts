import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { ConfigModule } from '@nestjs/config';
import {
  Organization,
  OrganizationSchema,
} from './schemas/organization.schema';
import { OrganizationsService } from './organizations.service';

@Module({
  imports: [
    ConfigModule,
    MongooseModule.forFeature([
      { name: Organization.name, schema: OrganizationSchema },
    ]),
  ],
  providers: [OrganizationsService],
  exports: [OrganizationsService, MongooseModule],
})
export class OrganizationsModule {}
