import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { MongooseModule } from '@nestjs/mongoose';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { validateEnv } from './config/env.validation';
import { UsersModule } from './users/users.module';
import { AuthModule } from './auth/auth.module';
import { ServiceCatalogModule } from './service-catalog/service-catalog.module';
import { CustomersModule } from './customers/customers.module';
import { VehiclesModule } from './vehicles/vehicles.module';
import { EstimatesModule } from './estimates/estimates.module';
import { SettingsModule } from './settings/settings.module';

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
    UsersModule,
    AuthModule,
    ServiceCatalogModule,
    CustomersModule,
    VehiclesModule,
    EstimatesModule,
    SettingsModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
