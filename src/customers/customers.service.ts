import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import {
  AuditLog,
  AuditLogDocument,
} from '../audit-logs/schemas/audit-log.schema';
import { asObjectId } from '../common/utils/object-id';
import { Job, JobDocument } from '../jobs/schemas/job.schema';
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
    @InjectModel(Job.name)
    private readonly jobModel: Model<JobDocument>,
    @InjectModel(AuditLog.name)
    private readonly auditLogModel: Model<AuditLogDocument>,
  ) {}

  async create(payload: CreateCustomerDto) {
    return this.customerModel.create({
      ...payload,
      email: payload.email?.toLowerCase() ?? null,
    });
  }

  async findAll() {
    return this.customerModel
      .find()
      .sort({ is_archived: 1, created_at: -1 })
      .exec();
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
      .sort({ is_archived: 1, created_at: -1 })
      .exec();
  }

  async archive(id: string, actorUserId?: string) {
    const customer = await this.findById(id);
    if (customer.is_archived === true) {
      return customer;
    }

    const before = customer.toObject();
    customer.is_archived = true;
    await customer.save();

    await this.recordAudit({
      actorUserId,
      entityType: 'customer',
      entityId: String(customer._id),
      action: 'customer.archived',
      before,
      after: customer.toObject(),
    });

    return customer;
  }

  async unarchive(id: string, actorUserId?: string) {
    const customer = await this.findById(id);
    if (customer.is_archived !== true) {
      return customer;
    }

    const before = customer.toObject();
    customer.is_archived = false;
    await customer.save();

    await this.recordAudit({
      actorUserId,
      entityType: 'customer',
      entityId: String(customer._id),
      action: 'customer.unarchived',
      before,
      after: customer.toObject(),
    });

    return customer;
  }

  async remove(id: string, actorUserId?: string) {
    const customer = await this.findById(id);
    const before = customer.toObject();
    const [vehicleCount, jobCount] = await Promise.all([
      this.vehicleModel.countDocuments({ customer_id: customer._id }).exec(),
      this.jobModel.countDocuments({ customer_id: customer._id }).exec(),
    ]);

    if (vehicleCount > 0 || jobCount > 0) {
      const blockers: string[] = [];
      if (vehicleCount > 0) {
        blockers.push(
          `${vehicleCount} vehicle${vehicleCount === 1 ? '' : 's'} still belong to this customer`,
        );
      }
      if (jobCount > 0) {
        blockers.push(
          `${jobCount} job${jobCount === 1 ? '' : 's'} still reference this customer`,
        );
      }

      throw new ConflictException(
        `Customer cannot be deleted while ${blockers.join(' and ')}. Archive the customer instead.`,
      );
    }

    await this.customerModel.deleteOne({ _id: customer._id }).exec();

    await this.recordAudit({
      actorUserId,
      entityType: 'customer',
      entityId: String(customer._id),
      action: 'customer.deleted',
      before,
      after: null,
    });

    return { deleted: true };
  }

  private async recordAudit(input: {
    actorUserId?: string;
    entityType: string;
    entityId: string;
    action: string;
    before: unknown | null;
    after: unknown | null;
  }) {
    await this.auditLogModel.create({
      actor_user_id: input.actorUserId
        ? asObjectId(input.actorUserId, 'actor user id')
        : null,
      entity_type: input.entityType,
      entity_id: input.entityId,
      action: input.action,
      before_json: (input.before ?? null) as Record<string, unknown> | null,
      after_json: (input.after ?? null) as Record<string, unknown> | null,
    });
  }
}
