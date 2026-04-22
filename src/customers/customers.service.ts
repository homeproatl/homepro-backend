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
import { Estimate, EstimateDocument } from '../estimates/schemas/estimate.schema';
import { Vehicle, VehicleDocument } from '../vehicles/schemas/vehicle.schema';
import { CreateCustomerDto } from './dto/create-customer.dto';
import { ListCustomersQueryDto } from './dto/list-customers-query.dto';
import { UpdateCustomerDto } from './dto/update-customer.dto';
import { Customer, CustomerDocument } from './schemas/customer.schema';

@Injectable()
export class CustomersService {
  constructor(
    @InjectModel(Customer.name)
    private readonly customerModel: Model<CustomerDocument>,
    @InjectModel(Vehicle.name)
    private readonly vehicleModel: Model<VehicleDocument>,
    @InjectModel(Estimate.name)
    private readonly estimateModel: Model<EstimateDocument>,
    @InjectModel(AuditLog.name)
    private readonly auditLogModel: Model<AuditLogDocument>,
  ) {}

  async create(payload: CreateCustomerDto) {
    const customer = await this.customerModel.create({
      ...payload,
      email: payload.email?.toLowerCase() ?? null,
    });

    return this.toCustomerContract(customer);
  }

  async findAll(query: ListCustomersQueryDto = {}) {
    const searchQuery = this.buildSearchQuery(query.search);

    const customers = await this.customerModel
      .find(searchQuery)
      .sort({ is_archived: 1, created_at: -1 })
      .exec();

    return customers.map((customer) => this.toCustomerContract(customer));
  }

  async findPage(query: ListCustomersQueryDto = {}) {
    const searchQuery = this.buildSearchQuery(query.search);
    const page = query.page ?? 1;
    const pageSize = query.page_size ?? 25;
    const skip = (page - 1) * pageSize;

    const [customers, total] = await Promise.all([
      this.customerModel
        .find(searchQuery)
        .sort({ is_archived: 1, created_at: -1 })
        .skip(skip)
        .limit(pageSize)
        .exec(),
      this.customerModel.countDocuments(searchQuery).exec(),
    ]);

    const pageCount = total === 0 ? 1 : Math.ceil(total / pageSize);
    const currentPage = Math.min(page, pageCount);

    return {
      items: customers.map((customer) => this.toCustomerContract(customer)),
      total,
      page: currentPage,
      page_size: pageSize,
      page_count: pageCount,
    };
  }

  async findById(id: string) {
    const customer = await this.findCustomerDocumentById(id);
    return this.toCustomerContract(customer);
  }

  async update(id: string, payload: UpdateCustomerDto) {
    const customer = await this.findCustomerDocumentById(id);
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
    return this.toCustomerContract(customer);
  }

  async findVehicles(id: string) {
    const customer = await this.findCustomerDocumentById(id);
    const vehicles = await this.vehicleModel
      .find({ customer_id: customer._id })
      .sort({ is_archived: 1, created_at: -1 })
      .exec();

    return vehicles.map((vehicle) => this.toVehicleContract(vehicle));
  }

  async archive(id: string, actorUserId?: string) {
    const customer = await this.findCustomerDocumentById(id);
    if (customer.is_archived === true) {
      return this.toCustomerContract(customer);
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

    return this.toCustomerContract(customer);
  }

  async unarchive(id: string, actorUserId?: string) {
    const customer = await this.findCustomerDocumentById(id);
    if (customer.is_archived !== true) {
      return this.toCustomerContract(customer);
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

    return this.toCustomerContract(customer);
  }

  async remove(id: string, actorUserId?: string) {
    const customer = await this.findCustomerDocumentById(id);
    const before = customer.toObject();
    const [vehicleCount, estimateCount] = await Promise.all([
      this.vehicleModel.countDocuments({ customer_id: customer._id }).exec(),
      this.estimateModel.countDocuments({ customer_id: customer._id }).exec(),
    ]);

    if (vehicleCount > 0 || estimateCount > 0) {
      const blockers: string[] = [];
      if (vehicleCount > 0) {
        blockers.push(
          `${vehicleCount} vehicle${vehicleCount === 1 ? '' : 's'} still belong to this customer`,
        );
      }
      if (estimateCount > 0) {
        blockers.push(
          `${estimateCount} estimate${estimateCount === 1 ? '' : 's'} still reference this customer`,
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
    before: object | null;
    after: object | null;
  }) {
    await this.auditLogModel.create({
      actor_user_id: input.actorUserId
        ? asObjectId(input.actorUserId, 'actor user id')
        : null,
      entity_type: input.entityType,
      entity_id: input.entityId,
      action: input.action,
      before_json: input.before as Record<string, unknown> | null,
      after_json: input.after as Record<string, unknown> | null,
    });
  }

  private async findCustomerDocumentById(id: string) {
    const customer = await this.customerModel
      .findById(asObjectId(id, 'customer id'))
      .exec();
    if (!customer) {
      throw new NotFoundException('Customer not found');
    }

    return customer;
  }

  private toCustomerContract(customer: CustomerDocument) {
    return {
      id: String(customer._id),
      first_name: customer.first_name,
      last_name: customer.last_name,
      phone: customer.phone,
      email: customer.email ?? null,
      is_archived: customer.is_archived === true,
      created_at: this.toIsoString(
        (customer as unknown as { created_at?: Date }).created_at,
      ),
      updated_at: this.toIsoString(
        (customer as unknown as { updated_at?: Date }).updated_at,
      ),
    };
  }

  private toVehicleContract(vehicle: VehicleDocument) {
    return {
      id: String(vehicle._id),
      customer_id: String(vehicle.customer_id),
      is_archived: vehicle.is_archived === true,
      color: vehicle.color ?? null,
      year: vehicle.year ?? null,
      make: vehicle.make,
      model: vehicle.model,
      sub_model: vehicle.sub_model ?? null,
      mileage: vehicle.mileage ?? null,
      mileage_out: vehicle.mileage_out ?? null,
      vin: vehicle.vin,
      license_plate: vehicle.license_plate,
      created_at: this.toIsoString(
        (vehicle as unknown as { created_at?: Date }).created_at,
      ),
      updated_at: this.toIsoString(
        (vehicle as unknown as { updated_at?: Date }).updated_at,
      ),
    };
  }

  private toIsoString(value?: Date) {
    return value?.toISOString();
  }

  private buildSearchQuery(search?: string) {
    if (!search) {
      return {};
    }

    const searchTokens = search
      .split(/\s+/)
      .map((token) => token.trim())
      .filter((token) => token.length > 0);
    const boundedSearchTokens = searchTokens.slice(0, 6);

    if (boundedSearchTokens.length === 0) {
      return {};
    }

    return {
      $and: boundedSearchTokens.map((token) => {
        const pattern = new RegExp(this.escapeRegExp(token), 'i');
        return {
          $or: [
            { first_name: pattern },
            { last_name: pattern },
            { phone: pattern },
            { email: pattern },
          ],
        };
      }),
    };
  }

  private escapeRegExp(value: string) {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }
}
