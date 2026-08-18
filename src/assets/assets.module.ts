import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { MongooseModule } from '@nestjs/mongoose';
import {
  AuditLog,
  AuditLogSchema,
} from '../audit-logs/schemas/audit-log.schema';
import { Client, ClientSchema } from '../clients/schemas/client.schema';
import {
  OrgDocument,
  OrgDocumentSchema,
} from '../documents/schemas/document.schema';
import {
  AppSettings,
  AppSettingsSchema,
} from '../settings/schemas/app-settings.schema';
import { AuthModule } from '../auth/auth.module';
import { AssetStorageService } from './asset-storage.service';
import { AssetsController } from './assets.controller';
import { AssetsService } from './assets.service';
import { CloudflareR2StorageService } from './cloudflare-r2-storage.service';
import { LocalAssetStorageService } from './local-asset-storage.service';
import { Asset, AssetSchema } from './schemas/asset.schema';

@Module({
  imports: [
    AuthModule,
    MongooseModule.forFeature([
      { name: Asset.name, schema: AssetSchema },
      { name: Client.name, schema: ClientSchema },
      { name: OrgDocument.name, schema: OrgDocumentSchema },
      { name: AppSettings.name, schema: AppSettingsSchema },
      { name: AuditLog.name, schema: AuditLogSchema },
    ]),
  ],
  controllers: [AssetsController],
  providers: [
    AssetsService,
    {
      provide: AssetStorageService,
      inject: [ConfigService],
      useFactory: (configService: ConfigService) =>
        configService.get<string>('STORAGE_PROVIDER') === 'r2'
          ? new CloudflareR2StorageService(configService)
          : new LocalAssetStorageService(configService),
    },
  ],
  exports: [AssetsService, AssetStorageService],
})
export class AssetsModule {}
