import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { asObjectId } from '../common/utils/object-id';
import { Vehicle, VehicleDocument } from '../vehicles/schemas/vehicle.schema';
import { CreateCustomerDto } from './dto/create-customer.dto';
import { UpdateCustomerDto } from './dto/update-customer.dto';
import { Customer, CustomerDocument } from './schemas/customer.schema';

@Injectable()
export class CustomersService {
  constructor(
    @InjectModel(Customer.name)
    private readonly customerModel: Model<CustomerDocument>,
    @InjectModel(Vehicle.name)
    private readonly vehicleModel: Model<VehicleDocument>,
  ) {}

  async create(payload: CreateCustomerDto) {
    return this.customerModel.create({
      ...payload,
      email: payload.email?.toLowerCase() ?? null,
    });
  }

  async findAll() {
    return this.customerModel.find().sort({ created_at: -1 }).exec();
  }

  async findById(id: string) {
    const customer = await this.customerModel
      .findById(asObjectId(id, 'customer id'))
      .exec();
    if (!customer) {
      throw new NotFoundException('Customer not found');
    }

    return customer;
  }

  async update(id: string, payload: UpdateCustomerDto) {
    const customer = await this.findById(id);
    if (payload.first_name !== undefined) {
      customer.first_name = payload.first_name;
    }
    if (payload.last_name !== undefined) {
      customer.last_name = payload.last_name;
    }
    if (payload.phone !== undefined) {
      customer.phone = payload.phone;
    }
    if (payload.email !== undefined) {
      customer.email = payload.email?.toLowerCase() ?? null;
    }
    await customer.save();
    return customer;
  }

  async findVehicles(id: string) {
    const customer = await this.findById(id);
    return this.vehicleModel
      .find({ customer_id: customer._id })
      .sort({ created_at: -1 })
      .exec();
  }
}
