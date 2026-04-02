import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { asObjectId } from '../common/utils/object-id';
import { calculateServiceTotals } from '../common/calculators/estimate-calculators';
import { Estimate, EstimateDocument } from '../estimates/schemas/estimate.schema';
import { CreateServiceDto } from './dto/create-service.dto';
import { UpdateServiceDto } from './dto/update-service.dto';
import {
  ServiceCatalog,
  ServiceCatalogDocument,
} from './schemas/service-catalog.schema';

type SeedService = {
  name: string;
  labor_lines: CreateServiceDto['labor_lines'];
  part_lines: CreateServiceDto['part_lines'];
};

const MINIMAL_SERVICES: SeedService[] = [
  {
    name: 'Oil Change',
    labor_lines: [
      {
        description: 'Oil service labor',
        hours: 0.75,
        rate: 80,
        discount_percent: 0,
      },
    ],
    part_lines: [
      {
        name: 'Engine oil',
        quantity: 1,
        cost: 18,
        price: 30,
        discount_percent: 0,
      },
      {
        name: 'Oil filter',
        quantity: 1,
        cost: 8,
        price: 15,
        discount_percent: 0,
      },
    ],
  },
  {
    name: 'Rear Brake Service',
    labor_lines: [
      {
        description: 'Rear brake labor',
        hours: 2,
        rate: 100,
        discount_percent: 0,
      },
    ],
    part_lines: [
      {
        name: 'Brake pads',
        quantity: 1,
        cost: 55,
        price: 85,
        discount_percent: 0,
      },
    ],
  },
];

type SerializedServiceCatalog = Record<string, unknown> & {
  usage_count: number;
  is_active: boolean;
};

@Injectable()
export class ServiceCatalogService implements OnModuleInit {
  private readonly logger = new Logger(ServiceCatalogService.name);

  constructor(
    @InjectModel(ServiceCatalog.name)
    private readonly serviceModel: Model<ServiceCatalogDocument>,
    @InjectModel(Estimate.name)
    private readonly estimateModel: Model<EstimateDocument>,
  ) {}

  async onModuleInit() {
    await this.ensureServiceIndexes();
  }

  private normalizeServiceName(name: string) {
    return name
      .trim()
      .toLowerCase()
      .replace(/[-_]+/g, ' ')
      .replace(/\s+/g, ' ');
  }

  private normalizeLineText(value: string) {
    return value.trim().toLowerCase().replace(/\s+/g, ' ');
  }

  private toLaborLineSignature(line: {
    description: string;
    hours: number;
    rate: number;
    discount_percent?: number;
  }) {
    return JSON.stringify([
      this.normalizeLineText(line.description),
      line.hours,
      line.rate,
      line.discount_percent ?? 0,
    ]);
  }

  private toPartLineSignature(line: {
    name: string;
    quantity: number;
    cost?: number | null;
    price: number;
    discount_percent?: number;
  }) {
    return JSON.stringify([
      this.normalizeLineText(line.name),
      line.quantity,
      line.cost ?? null,
      line.price,
      line.discount_percent ?? 0,
    ]);
  }

  private areServiceLinesIdentical(
    service: {
      labor_lines: Array<{
        description: string;
        hours: number;
        rate: number;
        discount_percent?: number;
      }>;
      part_lines: Array<{
        name: string;
        quantity: number;
        cost?: number | null;
        price: number;
        discount_percent?: number;
      }>;
    },
    candidate: {
      labor_lines: Array<{
        description: string;
        hours: number;
        rate: number;
        discount_percent?: number;
      }>;
      part_lines: Array<{
        name: string;
        quantity: number;
        cost?: number | null;
        price: number;
        discount_percent?: number;
      }>;
    },
  ) {
    const leftLabor = service.labor_lines.map((line) => this.toLaborLineSignature(line)).sort();
    const rightLabor = candidate.labor_lines
      .map((line) => this.toLaborLineSignature(line))
      .sort();
    const leftParts = service.part_lines.map((line) => this.toPartLineSignature(line)).sort();
    const rightParts = candidate.part_lines
      .map((line) => this.toPartLineSignature(line))
      .sort();

    return (
      leftLabor.length === rightLabor.length &&
      leftParts.length === rightParts.length &&
      leftLabor.every((value, index) => value === rightLabor[index]) &&
      leftParts.every((value, index) => value === rightParts[index])
    );
  }

  private async ensureServiceIndexes() {
    const collection = this.serviceModel.collection;
    if (
      !collection ||
      typeof collection.createIndex !== 'function'
    ) {
      return;
    }

    try {
      await collection.createIndex({ normalized_name: 1 }, { name: 'normalized_name_1' });
    } catch (error) {
      this.logger.warn(
        `Unable to ensure canned-service indexes: ${(error as Error).message}`,
      );
    }
  }

  private async findDuplicateByNameAndLines(
    name: string,
    candidate: {
      labor_lines: Array<{
        description: string;
        hours: number;
        rate: number;
        discount_percent?: number;
      }>;
      part_lines: Array<{
        name: string;
        quantity: number;
        cost?: number | null;
        price: number;
        discount_percent?: number;
      }>;
    },
    options?: { excludeId?: string },
  ) {
    const query: Record<string, unknown> = {
      normalized_name: this.normalizeServiceName(name),
    };

    if (options?.excludeId) {
      query._id = { $ne: asObjectId(options.excludeId, 'service id') };
    }

    const services = await this.serviceModel
      .find(query)
      .sort({ is_active: -1, name: 1, _id: 1 })
      .exec();

    return (
      services.find((service) => this.areServiceLinesIdentical(service, candidate)) ?? null
    );
  }

  private buildDuplicateConflict(service: ServiceCatalogDocument) {
    return new ConflictException({
      code: 'DUPLICATE_SERVICE_NAME',
      message: 'An identical canned service already exists.',
      duplicate_service: {
        id: String(service._id),
        name: service.name,
        is_active: service.is_active !== false,
      },
    });
  }

  private toServiceTotals(payload: {
    labor_lines: CreateServiceDto['labor_lines'];
    part_lines: CreateServiceDto['part_lines'];
  }) {
    if (payload.labor_lines.length === 0 && payload.part_lines.length === 0) {
      throw new BadRequestException(
        'Each canned service must include at least one labor or part row.',
      );
    }

    return calculateServiceTotals({
      laborLines: payload.labor_lines.map((line) => ({
        description: line.description,
        hours: line.hours,
        rate: line.rate,
        discountPercent: line.discount_percent,
      })),
      partLines: payload.part_lines.map((line) => ({
        name: line.name,
        quantity: line.quantity,
        cost: line.cost,
        price: line.price,
        discountPercent: line.discount_percent,
      })),
    });
  }

  private async getUsageCount(serviceId: ServiceCatalogDocument['_id']) {
    return this.estimateModel
      .countDocuments({ 'services.canned_service_id': serviceId })
      .exec();
  }

  private async getUsageCounts(
    serviceIds: Array<ServiceCatalogDocument['_id']>,
  ): Promise<Map<string, number>> {
    if (serviceIds.length === 0) {
      return new Map();
    }

    const counts = await this.estimateModel
      .aggregate<{ _id: ServiceCatalogDocument['_id']; count: number }>([
        { $unwind: '$services' },
        {
          $match: {
            'services.canned_service_id': { $in: serviceIds },
          },
        },
        {
          $group: {
            _id: '$services.canned_service_id',
            count: { $sum: 1 },
          },
        },
      ])
      .exec();

    return new Map(counts.map((entry) => [String(entry._id), entry.count]));
  }

  private async serializeService(
    service: ServiceCatalogDocument,
  ): Promise<SerializedServiceCatalog> {
    return {
      ...((service.toObject() as unknown) as Record<string, unknown>),
      is_active: service.is_active !== false,
      usage_count: await this.getUsageCount(service._id),
    };
  }

  private async serializeServices(services: ServiceCatalogDocument[]) {
    const usageCounts = await this.getUsageCounts(
      services.map((service) => service._id),
    );

    return services.map((service) => ({
      ...((service.toObject() as unknown) as Record<string, unknown>),
      is_active: service.is_active !== false,
      usage_count: usageCounts.get(String(service._id)) ?? 0,
    }));
  }

  async ensureMinimalCatalog(): Promise<void> {
    for (const item of MINIMAL_SERVICES) {
      const totals = this.toServiceTotals(item);
      const normalizedName = this.normalizeServiceName(item.name);
      await this.serviceModel
        .updateOne(
          { normalized_name: normalizedName },
          {
            $setOnInsert: {
              name: item.name,
              normalized_name: normalizedName,
              is_active: true,
              ...totals,
            },
          },
          { upsert: true },
        )
        .exec();
    }
  }

  async create(payload: CreateServiceDto) {
    const name = payload.name.trim();
    const totals = this.toServiceTotals(payload);
    const duplicate = await this.findDuplicateByNameAndLines(name, totals);
    if (duplicate) {
      throw this.buildDuplicateConflict(duplicate);
    }

    const service = await this.serviceModel.create({
      name,
      normalized_name: this.normalizeServiceName(name),
      is_active: true,
      ...totals,
    });

    return this.serializeService(service);
  }

  async findAll() {
    const services = await this.serviceModel
      .find()
      .sort({ is_active: -1, name: 1 })
      .exec();
    return this.serializeServices(services);
  }

  async findById(id: string) {
    const service = await this.serviceModel
      .findById(asObjectId(id, 'service id'))
      .exec();
    if (!service) {
      throw new NotFoundException('Service not found');
    }

    return this.serializeService(service);
  }

  async findDocumentById(id: string) {
    const service = await this.serviceModel
      .findById(asObjectId(id, 'service id'))
      .exec();
    if (!service) {
      throw new NotFoundException('Service not found');
    }

    return service;
  }

  async update(id: string, payload: UpdateServiceDto) {
    const service = await this.findDocumentById(id);
    const nextName = payload.name !== undefined ? payload.name.trim() : service.name;

    if (payload.name !== undefined) {
      service.name = nextName;
      service.normalized_name = this.normalizeServiceName(nextName);
    }

    const totals = this.toServiceTotals({
      labor_lines: payload.labor_lines ?? service.labor_lines,
      part_lines: payload.part_lines ?? service.part_lines,
    });

    const duplicate = await this.findDuplicateByNameAndLines(nextName, totals, {
      excludeId: id,
    });
    if (duplicate) {
      throw this.buildDuplicateConflict(duplicate);
    }

    service.labor_lines = totals.labor_lines;
    service.part_lines = totals.part_lines;
    service.labor_total = totals.labor_total;
    service.parts_total = totals.parts_total;
    service.total = totals.total;

    await service.save();
    return this.serializeService(service);
  }

  async deactivate(id: string) {
    const service = await this.findDocumentById(id);
    if (service.is_active === false) {
      return this.serializeService(service);
    }

    service.is_active = false;
    await service.save();
    return this.serializeService(service);
  }

  async reactivate(id: string) {
    const service = await this.findDocumentById(id);
    if (service.is_active !== false) {
      return this.serializeService(service);
    }

    service.is_active = true;
    await service.save();
    return this.serializeService(service);
  }

  async remove(id: string) {
    const serviceId = asObjectId(id, 'service id');
    const session = await this.serviceModel.db.startSession();

    try {
      await session.withTransaction(async () => {
        const service = await this.serviceModel
          .findById(serviceId)
          .session(session)
          .exec();
        if (!service) {
          throw new NotFoundException('Service not found');
        }

        const usageCount = await this.estimateModel
          .countDocuments({ 'services.canned_service_id': service._id })
          .session(session)
          .exec();

        if (usageCount > 0) {
          throw new ConflictException(
            'Service is already used on existing estimates. Deactivate it instead.',
          );
        }

        await this.serviceModel
          .deleteOne({ _id: service._id }, { session })
          .exec();
      });
    } finally {
      await session.endSession();
    }

    return { deleted: true };
  }
}
