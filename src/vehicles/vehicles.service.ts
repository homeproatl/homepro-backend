import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import {
  Customer,
  CustomerDocument,
} from '../customers/schemas/customer.schema';
import { asObjectId } from '../common/utils/object-id';
import { Job, JobDocument } from '../jobs/schemas/job.schema';
import { CreateVehicleDto } from './dto/create-vehicle.dto';
import { UpdateVehicleDto } from './dto/update-vehicle.dto';
import { Vehicle, VehicleDocument } from './schemas/vehicle.schema';

@Injectable()
export class VehiclesService {
  constructor(
    @InjectModel(Vehicle.name)
    private readonly vehicleModel: Model<VehicleDocument>,
    @InjectModel(Customer.name)
    private readonly customerModel: Model<CustomerDocument>,
    @InjectModel(Job.name)
    private readonly jobModel: Model<JobDocument>,
  ) {}

  async create(payload: CreateVehicleDto) {
    const customer = await this.customerModel
      .findById(asObjectId(payload.customer_id, 'customer id'))
      .exec();
    if (!customer) {
      throw new NotFoundException('Customer not found');
    }

    try {
      return await this.vehicleModel.create({
        customer_id: customer._id,
        color: payload.color ?? null,
        year: payload.year ?? null,
        make: payload.make,
        model: payload.model,
        sub_model: payload.sub_model ?? null,
        mileage: payload.mileage ?? null,
        vin: payload.vin,
        license_plate: payload.license_plate,
      });
    } catch (error) {
      if ((error as { code?: number }).code === 11000) {
        throw new ConflictException(
          'Vehicle VIN or license plate already exists',
        );
      }
      throw error;
    }
  }

  async findAll() {
    return this.vehicleModel.find().sort({ created_at: -1 }).exec();
  }

  async findById(id: string) {
    const vehicle = await this.vehicleModel
      .findById(asObjectId(id, 'vehicle id'))
      .exec();
    if (!vehicle) {
      throw new NotFoundException('Vehicle not found');
    }
    return vehicle;
  }

  async update(id: string, payload: UpdateVehicleDto) {
    const vehicle = await this.findById(id);

    if (payload.customer_id) {
      const customer = await this.customerModel
        .findById(asObjectId(payload.customer_id, 'customer id'))
        .exec();
      if (!customer) {
        throw new NotFoundException('Customer not found');
      }
      vehicle.customer_id = customer._id;
    }

    if (payload.color !== undefined) vehicle.color = payload.color;
    if (payload.year !== undefined) vehicle.year = payload.year;
    if (payload.make !== undefined) vehicle.make = payload.make;
    if (payload.model !== undefined) vehicle.set('model', payload.model);
    if (payload.sub_model !== undefined) vehicle.sub_model = payload.sub_model;
    if (payload.mileage !== undefined) vehicle.mileage = payload.mileage;
    if (payload.vin !== undefined) vehicle.vin = payload.vin;
    if (payload.license_plate !== undefined) {
      vehicle.license_plate = payload.license_plate;
    }

    try {
      await vehicle.save();
      return vehicle;
    } catch (error) {
      if ((error as { code?: number }).code === 11000) {
        throw new ConflictException(
          'Vehicle VIN or license plate already exists',
        );
      }
      throw error;
    }
  }

  async remove(id: string) {
    const vehicle = await this.findById(id);
    const jobCount = await this.jobModel
      .countDocuments({ vehicle_id: vehicle._id })
      .exec();

    if (jobCount > 0) {
      throw new ConflictException(
        `Vehicle cannot be deleted while ${jobCount} job${jobCount === 1 ? '' : 's'} still reference it.`,
      );
    }

    await this.vehicleModel.deleteOne({ _id: vehicle._id }).exec();

    return { deleted: true };
  }
}
