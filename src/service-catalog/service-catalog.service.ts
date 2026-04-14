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
import { Tag, TagDocument } from '../tags/schemas/tag.schema';
import { serializeEmbeddedTags } from '../tags/tag-serialization';
import { prepareEmbeddedTags } from '../tags/tag-write';
import { CreateServiceDto } from './dto/create-service.dto';
import { ListServicesQueryDto } from './dto/list-services-query.dto';
import { UpdateServiceDto } from './dto/update-service.dto';
import {
  ServiceCatalog,
  ServiceCatalogDocument,
} from './schemas/service-catalog.schema';

type SeedService = {
  name: string;
  note?: string | null;
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
  id: string;
  name: string;
  note: string | null;
  usage_count: number;
  is_active: boolean;
  labor_lines: Array<{
    id: string;
    description: string;
    hours: number;
    rate: number;
    discount_percent: number;
    subtotal: number;
    tags: Array<{
      id: string | null;
      scope: string;
      name: string;
      color: string;
    }>;
  }>;
  part_lines: Array<{
    id: string;
    name: string;
    part_number: string | null;
    quantity: number;
    cost: number | null;
    price: number;
    discount_percent: number;
    subtotal: number;
    tags: Array<{
      id: string | null;
      scope: string;
      name: string;
      color: string;
    }>;
  }>;
  labor_total: number;
  parts_total: number;
  total: number;
  created_at?: string;
  updated_at?: string;
};

@Injectable()
export class ServiceCatalogService implements OnModuleInit {
  private readonly logger = new Logger(ServiceCatalogService.name);

  constructor(
    @InjectModel(ServiceCatalog.name)
    private readonly serviceModel: Model<ServiceCatalogDocument>,
    @InjectModel(Estimate.name)
    private readonly estimateModel: Model<EstimateDocument>,
    @InjectModel(Tag.name)
    private readonly tagModel: Model<TagDocument> = {} as never,
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
    part_number?: string | null;
    quantity: number;
    cost?: number | null;
    price: number;
    discount_percent?: number;
  }) {
    return JSON.stringify([
      this.normalizeLineText(line.name),
      line.part_number
        ? this.normalizeLineText(line.part_number)
        : null,
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
        part_number?: string | null;
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
    const raw = service.toObject() as unknown as Record<string, unknown> & {
      _id?: unknown;
      labor_lines?: Array<Record<string, unknown>>;
      part_lines?: Array<Record<string, unknown>>;
      created_at?: Date | string;
      updated_at?: Date | string;
    };

    return {
      id: this.serializeId(raw._id, 'canned service id'),
      name: service.name,
      note: typeof raw.note === 'string' ? raw.note : null,
      is_active: service.is_active !== false,
      labor_lines: this.serializeLaborLines(raw.labor_lines),
      part_lines: this.serializePartLines(raw.part_lines),
      labor_total: service.labor_total,
      parts_total: service.parts_total,
      total: service.total,
      usage_count: await this.getUsageCount(service._id),
      created_at: this.toIsoString(raw.created_at),
      updated_at: this.toIsoString(raw.updated_at),
    };
  }

  private async serializeServices(services: ServiceCatalogDocument[]) {
    const usageCounts = await this.getUsageCounts(
      services.map((service) => service._id),
    );

    return services.map((service) => {
      const raw = service.toObject() as unknown as Record<string, unknown> & {
        _id?: unknown;
        labor_lines?: Array<Record<string, unknown>>;
        part_lines?: Array<Record<string, unknown>>;
        created_at?: Date | string;
        updated_at?: Date | string;
      };

      return {
        id: this.serializeId(raw._id, 'canned service id'),
        name: service.name,
        note: typeof raw.note === 'string' ? raw.note : null,
        is_active: service.is_active !== false,
        labor_lines: this.serializeLaborLines(raw.labor_lines),
        part_lines: this.serializePartLines(raw.part_lines),
        labor_total: service.labor_total,
        parts_total: service.parts_total,
        total: service.total,
        usage_count: usageCounts.get(String(service._id)) ?? 0,
        created_at: this.toIsoString(raw.created_at),
        updated_at: this.toIsoString(raw.updated_at),
      };
    });
  }

  private serializeLaborLines(lines?: Array<Record<string, unknown>>) {
    return (lines ?? []).map((line) => ({
      id: this.serializeId(line._id, 'canned service labor line id'),
      description: typeof line.description === 'string' ? line.description : '',
      hours: typeof line.hours === 'number' ? line.hours : 0,
      rate: typeof line.rate === 'number' ? line.rate : 0,
      discount_percent:
        typeof line.discount_percent === 'number' ? line.discount_percent : 0,
      subtotal: typeof line.subtotal === 'number' ? line.subtotal : 0,
      tags: this.serializeEmbeddedTags(
        line.tags as Array<Record<string, unknown>> | undefined,
        'LABOR',
      ),
    }));
  }

  private serializePartLines(lines?: Array<Record<string, unknown>>) {
    return (lines ?? []).map((line) => ({
      id: this.serializeId(line._id, 'canned service part line id'),
      name: typeof line.name === 'string' ? line.name : '',
      part_number:
        typeof line.part_number === 'string' && line.part_number.trim().length > 0
          ? line.part_number
          : null,
      quantity: typeof line.quantity === 'number' ? line.quantity : 0,
      cost: typeof line.cost === 'number' ? line.cost : null,
      price: typeof line.price === 'number' ? line.price : 0,
      discount_percent:
        typeof line.discount_percent === 'number' ? line.discount_percent : 0,
      subtotal: typeof line.subtotal === 'number' ? line.subtotal : 0,
      tags: this.serializeEmbeddedTags(
        line.tags as Array<Record<string, unknown>> | undefined,
        'PART',
      ),
    }));
  }

  private serializeEmbeddedTags(
    lines: Array<Record<string, unknown>> | undefined,
    expectedScope: 'LABOR' | 'PART',
  ) {
    return serializeEmbeddedTags(lines, expectedScope, (value, context) =>
      this.serializeId(value, context),
    );
  }

  private serializeId(value: unknown, context: string) {
    if (typeof value === 'string' && value.length > 0) {
      return value;
    }

    if (value && typeof value === 'object' && typeof value.toString === 'function') {
      const serialized = value.toString();
      if (serialized && serialized !== '[object Object]') {
        return serialized;
      }
    }

    throw new Error(`Invalid ${context}`);
  }

  private toIsoString(value?: Date | string) {
    if (!value) {
      return undefined;
    }

    return value instanceof Date ? value.toISOString() : value;
  }

  async ensureMinimalCatalog(): Promise<void> {
    for (const item of MINIMAL_SERVICES) {
      const totals = await this.toServiceTotals(item);
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
    const totals = await this.toServiceTotals(payload);
    const duplicate = await this.findDuplicateByNameAndLines(name, totals);
    if (duplicate) {
      throw this.buildDuplicateConflict(duplicate);
    }

    const service = await this.serviceModel.create({
      name,
      normalized_name: this.normalizeServiceName(name),
      note: payload.note ?? null,
      is_active: true,
      ...totals,
    });

    return this.serializeService(service);
  }

  async findAll(query: ListServicesQueryDto = {}) {
    const services = await this.serviceModel
      .find(this.buildSearchQuery(query.search))
      .sort({ is_active: -1, name: 1 })
      .exec();
    return this.serializeServices(services);
  }

  async findPage(query: ListServicesQueryDto = {}) {
    const searchQuery = this.buildSearchQuery(query.search);
    const page = query.page ?? 1;
    const pageSize = query.page_size ?? 25;
    const skip = (page - 1) * pageSize;

    const [services, total] = await Promise.all([
      this.serviceModel
        .find(searchQuery)
        .sort({ is_active: -1, name: 1 })
        .skip(skip)
        .limit(pageSize)
        .exec(),
      this.serviceModel.countDocuments(searchQuery).exec(),
    ]);

    const pageCount = total === 0 ? 1 : Math.ceil(total / pageSize);
    const currentPage = Math.min(page, pageCount);

    return {
      items: await this.serializeServices(services),
      total,
      page: currentPage,
      page_size: pageSize,
      page_count: pageCount,
    };
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

    if (payload.note !== undefined) {
      service.note = payload.note ?? null;
    }

    const totals = await this.toServiceTotals({
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

  private async toServiceTotals(payload: {
    labor_lines: CreateServiceDto['labor_lines'];
    part_lines: CreateServiceDto['part_lines'];
  }) {
    if (payload.labor_lines.length === 0 && payload.part_lines.length === 0) {
      throw new BadRequestException(
        'Each canned service must include at least one labor or part row.',
      );
    }

    const preparedLaborTags = await Promise.all(
      payload.labor_lines.map((line) =>
        prepareEmbeddedTags(this.tagModel, line.tags, 'LABOR'),
      ),
    );
    const preparedPartTags = await Promise.all(
      payload.part_lines.map((line) =>
        prepareEmbeddedTags(this.tagModel, line.tags, 'PART'),
      ),
    );

    const totals = calculateServiceTotals({
      laborLines: payload.labor_lines.map((line, index) => ({
        description: line.description,
        hours: line.hours,
        rate: line.rate,
        discountPercent: line.discount_percent,
        tags: preparedLaborTags[index].map((tag) => ({
          id: tag.tag_id ? String(tag.tag_id) : null,
          scope: tag.scope,
          name: tag.name,
          color: tag.color,
        })),
      })),
      partLines: payload.part_lines.map((line, index) => ({
        name: line.name,
        partNumber: line.part_number ?? null,
        quantity: line.quantity,
        cost: line.cost,
        price: line.price,
        discountPercent: line.discount_percent,
        tags: preparedPartTags[index].map((tag) => ({
          id: tag.tag_id ? String(tag.tag_id) : null,
          scope: tag.scope,
          name: tag.name,
          color: tag.color,
        })),
      })),
    });

    return {
      labor_lines: totals.labor_lines.map((line) => ({
        ...line,
        tags: line.tags.map((tag) => ({
          tag_id: tag.tag_id ? asObjectId(tag.tag_id, 'tag id') : null,
          scope: tag.scope,
          name: tag.name,
          color: tag.color,
        })),
      })),
      part_lines: totals.part_lines.map((line) => ({
        ...line,
        tags: line.tags.map((tag) => ({
          tag_id: tag.tag_id ? asObjectId(tag.tag_id, 'tag id') : null,
          scope: tag.scope,
          name: tag.name,
          color: tag.color,
        })),
      })),
      labor_total: totals.labor_total,
      parts_total: totals.parts_total,
      total: totals.total,
    };
  }

  private buildSearchQuery(search?: string) {
    if (!search) {
      return {};
    }

    return {
      name: {
        $regex: this.escapeRegex(search.trim()),
        $options: 'i',
      },
    };
  }

  private escapeRegex(value: string) {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }
}
