import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { MongooseModule } from '@nestjs/mongoose';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { validateEnv } from './config/env.validation';
import { UsersModule } from './users/users.module';
import { AuthModule } from './auth/auth.module';
import { OrganizationsModule } from './organizations/organizations.module';
import { ItemsModule } from './items/items.module';
import { ClientsModule } from './clients/clients.module';
import { EstimatesModule } from './estimates/estimates.module';
import { DocumentsModule } from './documents/documents.module';
import { InvoicesModule } from './invoices/invoices.module';
import { SettingsModule } from './settings/settings.module';
import { AssetsModule } from './assets/assets.module';
import { DashboardModule } from './dashboard/dashboard.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      validate: validateEnv,
    }),
    MongooseModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => ({
        // Transactions require a Mongo deployment that supports them (replica set/sharded cluster).
        uri: configService.getOrThrow<string>('MONGO_URI'),
        readPreference: 'primary',
        retryWrites: true,
        w: 'majority',
      }),
    }),
    OrganizationsModule,
    UsersModule,
    AuthModule,
    ItemsModule,
    ClientsModule,
    EstimatesModule,
    DocumentsModule,
    InvoicesModule,
    SettingsModule,
    AssetsModule,
    DashboardModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
