import { Module, forwardRef } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { MongooseModule } from '@nestjs/mongoose';
import { AuthModule } from '../auth/auth.module';
import { DocumentsModule } from '../documents/documents.module';
import { AppSettings, AppSettingsSchema } from './schemas/app-settings.schema';
import { SettingsController } from './settings.controller';
import { SettingsService } from './settings.service';

@Module({
  imports: [
    ConfigModule,
    AuthModule,
    forwardRef(() => DocumentsModule),
    MongooseModule.forFeature([
      { name: AppSettings.name, schema: AppSettingsSchema },
    ]),
  ],
  controllers: [SettingsController],
  providers: [SettingsService],
  exports: [SettingsService],
})
export class SettingsModule {}
