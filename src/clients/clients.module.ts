import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import {
  AuditLog,
  AuditLogSchema,
} from '../audit-logs/schemas/audit-log.schema';
import { AuthModule } from '../auth/auth.module';
import {
  OrgDocument,
  OrgDocumentSchema,
} from '../documents/schemas/document.schema';
import { ClientsController } from './clients.controller';
import { ClientsService } from './clients.service';
import { Client, ClientSchema } from './schemas/client.schema';

@Module({
  imports: [
    AuthModule,
    MongooseModule.forFeature([
      { name: Client.name, schema: ClientSchema },
      { name: OrgDocument.name, schema: OrgDocumentSchema },
      { name: AuditLog.name, schema: AuditLogSchema },
    ]),
  ],
  controllers: [ClientsController],
  providers: [ClientsService],
  exports: [ClientsService, MongooseModule],
})
export class ClientsModule {}
