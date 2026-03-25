import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { MongooseModule } from '@nestjs/mongoose';
import { Job, JobSchema } from '../jobs/schemas/job.schema';
import { AuthGuard } from '../auth/guards/auth.guard';
import { Vehicle, VehicleSchema } from '../vehicles/schemas/vehicle.schema';
import { CustomersController } from './customers.controller';
import { CustomersService } from './customers.service';
import { Customer, CustomerSchema } from './schemas/customer.schema';

@Module({
  imports: [
    ConfigModule,
    JwtModule.register({}),
    MongooseModule.forFeature([
      { name: Customer.name, schema: CustomerSchema },
      { name: Vehicle.name, schema: VehicleSchema },
      { name: Job.name, schema: JobSchema },
    ]),
  ],
  controllers: [CustomersController],
  providers: [CustomersService, AuthGuard],
  exports: [CustomersService],
})
export class CustomersModule {}
