import {
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, PipelineStage } from 'mongoose';
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
import { ListVehiclesQueryDto } from './dto/list-vehicles-query.dto';
import { UpdateVehicleDto } from './dto/update-vehicle.dto';
import { Vehicle, VehicleDocument } from './schemas/vehicle.schema';

@Injectable()
export class VehiclesService implements OnModuleInit {
  private readonly logger = new Logger(VehiclesService.name);

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

  async onModuleInit() {
    await this.ensureVehicleIdentifierIndexes();
  }

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

    const vin = this.normalizeVehicleIdentifier(payload.vin);
    const licensePlate = this.normalizeVehicleIdentifier(payload.license_plate);

    try {
      const vehicle = await this.vehicleModel.create({
        customer_id: customer._id,
        is_archived: false,
        is_incomplete: this.isVehicleIncomplete(vin, licensePlate),
        color: payload.color ?? null,
        year: payload.year ?? null,
        make: payload.make,
        model: payload.model,
        sub_model: payload.sub_model ?? null,
        mileage: payload.mileage ?? null,
        mileage_out: payload.mileage_out ?? null,
        vin,
        license_plate: licensePlate,
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

  async findAll(query: ListVehiclesQueryDto = {}) {
    const vehicles = await this.findVehicleList(query);
    return vehicles;
  }

  async findPage(query: ListVehiclesQueryDto = {}) {
    const page = query.page ?? 1;
    const pageSize = query.page_size ?? 25;
    const skip = (page - 1) * pageSize;
    const { items, total } = await this.findPaginatedVehicleList(query, {
      skip,
      limit: pageSize,
    });
    const pageCount = total === 0 ? 1 : Math.ceil(total / pageSize);
    const currentPage = Math.min(page, pageCount);

    return {
      items,
      total,
      page: currentPage,
      page_size: pageSize,
      page_count: pageCount,
    };
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
    if (payload.mileage_out !== undefined) {
      vehicle.mileage_out = payload.mileage_out;
    }
    if (payload.vin !== undefined) {
      vehicle.vin = this.normalizeVehicleIdentifier(payload.vin);
    }
    if (payload.license_plate !== undefined) {
      vehicle.license_plate = this.normalizeVehicleIdentifier(
        payload.license_plate,
      );
    }
    vehicle.is_incomplete = this.isVehicleIncomplete(
      vehicle.vin,
      vehicle.license_plate,
    );

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
    const vin = vehicle.vin ?? null;
    const licensePlate = vehicle.license_plate ?? null;

    return {
      id: String(vehicle._id),
      customer_id: String(vehicle.customer_id),
      is_archived: vehicle.is_archived === true,
      is_incomplete:
        vehicle.is_incomplete === true ||
        this.isVehicleIncomplete(vin, licensePlate),
      color: vehicle.color ?? null,
      year: vehicle.year ?? null,
      make: vehicle.make,
      model: vehicle.model,
      sub_model: vehicle.sub_model ?? null,
      mileage: vehicle.mileage ?? null,
      mileage_out: vehicle.mileage_out ?? null,
      vin,
      license_plate: licensePlate,
      created_at: this.toIsoString(
        (vehicle as unknown as { created_at?: Date }).created_at,
      ),
      updated_at: this.toIsoString(
        (vehicle as unknown as { updated_at?: Date }).updated_at,
      ),
    };
  }

  private async findVehicleList(
    query: ListVehiclesQueryDto,
    options?: { skip?: number; limit?: number },
  ) {
    const pipeline = this.buildVehicleListPipeline(query, options);
    const result = await this.vehicleModel.aggregate(pipeline).exec();

    return (result as Array<Record<string, unknown>>).map((vehicle) =>
      this.normalizeVehicleListItem(vehicle),
    );
  }

  private async findPaginatedVehicleList(
    query: ListVehiclesQueryDto,
    options: { skip?: number; limit?: number },
  ) {
    const pipeline = this.buildVehicleFacetPipeline(query, options);
    const result = await this.vehicleModel.aggregate(pipeline).exec();
    const first = (result[0] ?? {}) as {
      items?: Array<Record<string, unknown>>;
      metadata?: Array<{ total?: number }>;
    };
    const items = Array.isArray(first.items)
      ? first.items.map((vehicle) => this.normalizeVehicleListItem(vehicle))
      : [];
    const total = Array.isArray(first.metadata)
      ? (first.metadata[0]?.total ?? 0)
      : 0;

    return { items, total };
  }

  private buildVehicleListPipeline(
    query: ListVehiclesQueryDto,
    options?: { skip?: number; limit?: number },
  ): PipelineStage[] {
    const pipeline: PipelineStage[] = [];

    if (query.is_archived !== undefined) {
      pipeline.push({
        $match: {
          is_archived: query.is_archived,
        },
      });
    }

    pipeline.push(
      {
        $lookup: {
          from: 'customers',
          localField: 'customer_id',
          foreignField: '_id',
          as: 'customer',
        },
      },
      {
        $unwind: {
          path: '$customer',
          preserveNullAndEmptyArrays: true,
        },
      },
    );

    const trimmedSearch = query.search?.trim();
    if (trimmedSearch) {
      const searchRegex = new RegExp(this.escapeRegex(trimmedSearch), 'i');
      pipeline.push({
        $match: {
          $or: [
            { make: searchRegex },
            { model: searchRegex },
            { sub_model: searchRegex },
            { vin: searchRegex },
            { license_plate: searchRegex },
            { 'customer.first_name': searchRegex },
            { 'customer.last_name': searchRegex },
          ],
        },
      });
    }

    pipeline.push(
      { $sort: { is_archived: 1, created_at: -1 } },
      {
        $project: {
          _id: 1,
          customer_id: 1,
          is_archived: 1,
          is_incomplete: 1,
          color: 1,
          year: 1,
          make: 1,
          model: 1,
          sub_model: 1,
          mileage: 1,
          mileage_out: 1,
          vin: 1,
          license_plate: 1,
          created_at: 1,
          updated_at: 1,
          customer_name: {
            $trim: {
              input: {
                $concat: [
                  { $ifNull: ['$customer.first_name', ''] },
                  ' ',
                  { $ifNull: ['$customer.last_name', ''] },
                ],
              },
            },
          },
        },
      },
    );

    if (options?.skip) {
      pipeline.push({ $skip: options.skip });
    }
    if (options?.limit) {
      pipeline.push({ $limit: options.limit });
    }

    return pipeline;
  }

  private buildVehicleFacetPipeline(
    query: ListVehiclesQueryDto,
    options?: { skip?: number; limit?: number },
  ): PipelineStage[] {
    const pipeline = this.buildVehicleListPipeline(query);
    const itemsPipeline = [
      ...(options?.skip ? [{ $skip: options.skip }] : []),
      ...(options?.limit ? [{ $limit: options.limit }] : []),
    ] as unknown as PipelineStage.FacetPipelineStage[];
    pipeline.push({
      $facet: {
        items: itemsPipeline,
        metadata: [{ $count: 'total' }],
      },
    });
    return pipeline;
  }

  private normalizeVehicleListItem(raw: Record<string, unknown>) {
    const vin = typeof raw.vin === 'string' && raw.vin.length > 0 ? raw.vin : null;
    const licensePlate =
      typeof raw.license_plate === 'string' && raw.license_plate.length > 0
        ? raw.license_plate
        : null;
    const customerName =
      typeof raw.customer_name === 'string' && raw.customer_name.trim().length > 0
        ? raw.customer_name.trim()
        : null;

    return {
      id: String(raw._id),
      customer_id: String(raw.customer_id),
      is_archived: raw.is_archived === true,
      is_incomplete:
        raw.is_incomplete === true ||
        this.isVehicleIncomplete(vin, licensePlate),
      color: typeof raw.color === 'string' ? raw.color : null,
      year: typeof raw.year === 'number' ? raw.year : null,
      make: typeof raw.make === 'string' ? raw.make : '',
      model: typeof raw.model === 'string' ? raw.model : '',
      sub_model: typeof raw.sub_model === 'string' ? raw.sub_model : null,
      mileage: typeof raw.mileage === 'number' ? raw.mileage : null,
      mileage_out: typeof raw.mileage_out === 'number' ? raw.mileage_out : null,
      vin,
      license_plate: licensePlate,
      customer_name: customerName,
      created_at: this.toIsoString(
        raw.created_at instanceof Date ? raw.created_at : undefined,
      ),
      updated_at: this.toIsoString(
        raw.updated_at instanceof Date ? raw.updated_at : undefined,
      ),
    };
  }

  private toIsoString(value?: Date) {
    return value?.toISOString();
  }

  private async ensureVehicleIdentifierIndexes() {
    const collection = this.vehicleModel.collection;
    const existingIndexes = await collection.indexes();

    const vinIndex = existingIndexes.find((index) => index.name === 'vin_1');
    const licensePlateIndex = existingIndexes.find(
      (index) => index.name === 'license_plate_1',
    );

    const needsVinRepair = !this.hasNullableIdentifierIndex(vinIndex, 'vin');
    const needsLicensePlateRepair = !this.hasNullableIdentifierIndex(
      licensePlateIndex,
      'license_plate',
    );

    if (!needsVinRepair && !needsLicensePlateRepair) {
      return;
    }

    const dropped: string[] = [];

    for (const [indexName, needsRepair] of [
      ['vin_1', needsVinRepair],
      ['license_plate_1', needsLicensePlateRepair],
    ] as const) {
      if (!needsRepair) {
        continue;
      }

      if (existingIndexes.some((index) => index.name === indexName)) {
        try {
          await collection.dropIndex(indexName);
          dropped.push(indexName);
        } catch (error) {
          if (!this.isVehicleIndexMissingError(error)) {
            const repairedByPeer = await this.waitForNullableIdentifierIndex(
              collection,
              indexName === 'vin_1' ? 'vin' : 'license_plate',
              indexName,
            );
            if (!repairedByPeer) {
              throw error;
            }
          }
        }
      }
    }

    await collection.updateMany(
      {},
      [
        {
          $set: {
            vin: {
              $cond: [
                {
                  $or: [
                    { $eq: ['$vin', ''] },
                    { $eq: ['$vin', null] },
                  ],
                },
                null,
                '$vin',
              ],
            },
            license_plate: {
              $cond: [
                {
                  $or: [
                    { $eq: ['$license_plate', ''] },
                    { $eq: ['$license_plate', null] },
                  ],
                },
                null,
                '$license_plate',
              ],
            },
          },
        },
        {
          $set: {
            is_incomplete: {
              $or: [
                { $eq: ['$vin', null] },
                { $eq: ['$license_plate', null] },
              ],
            },
          },
        },
      ],
    );

    const created: string[] = [];

    if (needsVinRepair) {
      const createdVinIndex = await this.ensureNullableIdentifierIndex(
        collection,
        'vin',
        'vin_1',
      );
      if (createdVinIndex) {
        created.push('vin_1');
      }
    }

    if (needsLicensePlateRepair) {
      const createdLicensePlateIndex = await this.ensureNullableIdentifierIndex(
        collection,
        'license_plate',
        'license_plate_1',
      );
      if (createdLicensePlateIndex) {
        created.push('license_plate_1');
      }
    }

    this.logger.warn(
      `Repaired vehicle identifier indexes. Dropped: ${dropped.join(', ') || 'none'}. Created: ${created.join(', ') || 'none'}.`,
    );
  }

  private hasNullableIdentifierIndex(
    index:
      | {
          unique?: boolean;
          partialFilterExpression?: Record<string, unknown>;
        }
      | undefined,
    field: 'vin' | 'license_plate',
  ) {
    if (!index?.unique) {
      return false;
    }

    const filter = index.partialFilterExpression;
    if (!filter || typeof filter !== 'object') {
      return false;
    }

    const fieldFilter = filter[field];
    if (!fieldFilter || typeof fieldFilter !== 'object') {
      return false;
    }

    return '$type' in fieldFilter && fieldFilter.$type === 'string';
  }

  private async ensureNullableIdentifierIndex(
    collection: Pick<
      Model<VehicleDocument>['collection'],
      'createIndex' | 'indexes'
    >,
    field: 'vin' | 'license_plate',
    indexName: 'vin_1' | 'license_plate_1',
  ) {
    try {
      if (field === 'vin') {
        await collection.createIndex(
          { vin: 1 },
          {
            name: indexName,
            unique: true,
            partialFilterExpression: {
              vin: { $type: 'string' },
            },
          },
        );
      } else {
        await collection.createIndex(
          { license_plate: 1 },
          {
            name: indexName,
            unique: true,
            partialFilterExpression: {
              license_plate: { $type: 'string' },
            },
          },
        );
      }
      return true;
    } catch (error) {
      const repairedByPeer = await this.waitForNullableIdentifierIndex(
        collection,
        field,
        indexName,
      );
      if (repairedByPeer) {
        return false;
      }

      throw error;
    }
  }

  private async waitForNullableIdentifierIndex(
    collection: Pick<Model<VehicleDocument>['collection'], 'indexes'>,
    field: 'vin' | 'license_plate',
    indexName: 'vin_1' | 'license_plate_1',
    attempts = 4,
  ) {
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      const currentIndexes = await collection.indexes();
      const currentIndex = currentIndexes.find(
        (index) => index.name === indexName,
      );
      if (this.hasNullableIdentifierIndex(currentIndex, field)) {
        return true;
      }

      if (attempt < attempts - 1) {
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
    }

    return false;
  }

  private isVehicleIndexMissingError(error: unknown) {
    if (!error || typeof error !== 'object') {
      return false;
    }

    const code =
      'code' in error && typeof error.code === 'number'
        ? error.code
        : null;
    const codeName =
      'codeName' in error && typeof error.codeName === 'string'
        ? error.codeName
        : null;

    return code === 27 || codeName === 'IndexNotFound';
  }

  private escapeRegex(value: string) {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  private normalizeVehicleIdentifier(value?: string | null) {
    const trimmed = value?.trim();
    return trimmed ? trimmed.toUpperCase() : null;
  }

  private isVehicleIncomplete(
    vin: string | null | undefined,
    licensePlate: string | null | undefined,
  ) {
    return !vin || !licensePlate;
  }
}
