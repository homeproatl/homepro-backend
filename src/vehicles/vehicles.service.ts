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
import {
  Customer,
  CustomerDocument,
} from '../customers/schemas/customer.schema';
import { asObjectId } from '../common/utils/object-id';
import { Estimate, EstimateDocument } from '../estimates/schemas/estimate.schema';
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
    @InjectModel(Estimate.name)
    private readonly estimateModel: Model<EstimateDocument>,
    @InjectModel(AuditLog.name)
    private readonly auditLogModel: Model<AuditLogDocument>,
  ) {}

  async create(payload: CreateVehicleDto) {
    const customer = await this.customerModel
      .findById(asObjectId(payload.customer_id, 'customer id'))
      .exec();
    if (!customer) {
      throw new NotFoundException('Customer not found');
    }
    if (customer.is_archived === true) {
      throw new ConflictException(
        'Vehicle cannot be created for an archived customer.',
      );
    }

    try {
      const vehicle = await this.vehicleModel.create({
        customer_id: customer._id,
        is_archived: false,
        color: payload.color ?? null,
        year: payload.year ?? null,
        make: payload.make,
        model: payload.model,
        sub_model: payload.sub_model ?? null,
        mileage: payload.mileage ?? null,
        vin: payload.vin,
        license_plate: payload.license_plate,
      });

      return this.toVehicleContract(vehicle);
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
    const vehicles = await this.vehicleModel
      .find()
      .sort({ is_archived: 1, created_at: -1 })
      .exec();

    return vehicles.map((vehicle) => this.toVehicleContract(vehicle));
  }

  async findById(id: string) {
    const vehicle = await this.findVehicleDocumentById(id);
    return this.toVehicleContract(vehicle);
  }

  async update(id: string, payload: UpdateVehicleDto) {
    const vehicle = await this.findVehicleDocumentById(id);

    if (payload.customer_id) {
      const customer = await this.customerModel
        .findById(asObjectId(payload.customer_id, 'customer id'))
        .exec();
      if (!customer) {
        throw new NotFoundException('Customer not found');
      }
      if (
        customer.is_archived === true &&
        String(customer._id) !== String(vehicle.customer_id)
      ) {
        throw new ConflictException(
          'Vehicle cannot be assigned to an archived customer.',
        );
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
      return this.toVehicleContract(vehicle);
    } catch (error) {
      if ((error as { code?: number }).code === 11000) {
        throw new ConflictException(
          'Vehicle VIN or license plate already exists',
        );
      }
      throw error;
    }
  }

  async archive(id: string, actorUserId?: string) {
    const vehicle = await this.findVehicleDocumentById(id);
    if (vehicle.is_archived === true) {
      return this.toVehicleContract(vehicle);
    }

    const before = vehicle.toObject();
    vehicle.is_archived = true;
    await vehicle.save();

    await this.recordAudit({
      actorUserId,
      entityType: 'vehicle',
      entityId: String(vehicle._id),
      action: 'vehicle.archived',
      before,
      after: vehicle.toObject(),
    });

    return this.toVehicleContract(vehicle);
  }

  async unarchive(id: string, actorUserId?: string) {
    const vehicle = await this.findVehicleDocumentById(id);
    if (vehicle.is_archived !== true) {
      return this.toVehicleContract(vehicle);
    }

    const owner = await this.customerModel.findById(vehicle.customer_id).exec();
    if (!owner) {
      throw new NotFoundException('Customer not found');
    }
    if (owner.is_archived === true) {
      throw new ConflictException(
        'Vehicle cannot be unarchived while its customer is archived.',
      );
    }

    const before = vehicle.toObject();
    vehicle.is_archived = false;
    await vehicle.save();

    await this.recordAudit({
      actorUserId,
      entityType: 'vehicle',
      entityId: String(vehicle._id),
      action: 'vehicle.unarchived',
      before,
      after: vehicle.toObject(),
    });

    return this.toVehicleContract(vehicle);
  }

  async remove(id: string, actorUserId?: string) {
    const vehicle = await this.findVehicleDocumentById(id);
    const before = vehicle.toObject();
    const estimateCount = await this.estimateModel
      .countDocuments({ vehicle_id: vehicle._id })
      .exec();

    if (estimateCount > 0) {
      throw new ConflictException(
        `Vehicle cannot be deleted while ${estimateCount} estimate${estimateCount === 1 ? '' : 's'} still reference it. Archive the vehicle instead.`,
      );
    }

    await this.vehicleModel.deleteOne({ _id: vehicle._id }).exec();

    await this.recordAudit({
      actorUserId,
      entityType: 'vehicle',
      entityId: String(vehicle._id),
      action: 'vehicle.deleted',
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

  private async findVehicleDocumentById(id: string) {
    const vehicle = await this.vehicleModel
      .findById(asObjectId(id, 'vehicle id'))
      .exec();
    if (!vehicle) {
      throw new NotFoundException('Vehicle not found');
    }

    return vehicle;
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
}
