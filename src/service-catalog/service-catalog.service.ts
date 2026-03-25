import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { JobService, JobServiceDocument } from '../jobs/schemas/job-service.schema';
import {
  ServiceCatalog,
  ServiceCatalogDocument,
} from './schemas/service-catalog.schema';
import { asObjectId } from '../common/utils/object-id';
import { CreateServiceDto } from './dto/create-service.dto';
import { UpdateServiceDto } from './dto/update-service.dto';

type SeedService = {
  name: string;
  base_price: number;
  estimated_duration_minutes: number;
};

const MINIMAL_SERVICES: SeedService[] = [
  { name: 'Oil Change', base_price: 50, estimated_duration_minutes: 45 },
  {
    name: 'Brake Replacement',
    base_price: 180,
    estimated_duration_minutes: 120,
  },
  { name: 'Engine Repair', base_price: 450, estimated_duration_minutes: 240 },
];

type SerializedServiceCatalog = {
  _id: ServiceCatalogDocument['_id'];
  name: string;
  is_active: boolean;
  base_price: number | null;
  estimated_duration_minutes: number | null;
  created_at?: Date;
  updated_at?: Date;
  usage_count: number;
};

@Injectable()
export class ServiceCatalogService {
  constructor(
    @InjectModel(ServiceCatalog.name)
    private readonly serviceModel: Model<ServiceCatalogDocument>,
    @InjectModel(JobService.name)
    private readonly jobServiceModel: Model<JobServiceDocument>,
  ) {}

  private async getUsageCount(serviceId: ServiceCatalogDocument['_id']) {
    return this.jobServiceModel.countDocuments({ service_id: serviceId }).exec();
  }

  private async getUsageCounts(
    serviceIds: Array<ServiceCatalogDocument['_id']>,
  ): Promise<Map<string, number>> {
    if (serviceIds.length === 0) {
      return new Map();
    }

    const counts = await this.jobServiceModel
      .aggregate<{ _id: ServiceCatalogDocument['_id']; count: number }>([
        {
          $match: {
            service_id: { $in: serviceIds },
          },
        },
        {
          $group: {
            _id: '$service_id',
            count: { $sum: 1 },
          },
        },
      ])
      .exec();

    return new Map(
      counts.map((entry) => [String(entry._id), entry.count]),
    );
  }

  private async serializeService(
    service: ServiceCatalogDocument,
  ): Promise<SerializedServiceCatalog> {
    return {
      ...(service.toObject() as Omit<SerializedServiceCatalog, 'usage_count' | 'is_active'>),
      is_active: service.is_active !== false,
      usage_count: await this.getUsageCount(service._id),
    };
  }

  private async serializeServices(services: ServiceCatalogDocument[]) {
    const usageCounts = await this.getUsageCounts(
      services.map((service) => service._id),
    );

    return services.map((service) => ({
      ...(service.toObject() as Omit<SerializedServiceCatalog, 'usage_count' | 'is_active'>),
      is_active: service.is_active !== false,
      usage_count: usageCounts.get(String(service._id)) ?? 0,
    }));
  }

  async ensureMinimalCatalog(): Promise<void> {
    for (const item of MINIMAL_SERVICES) {
      await this.serviceModel
        .updateOne(
          { name: item.name },
          {
            $setOnInsert: {
              name: item.name,
              is_active: true,
              base_price: item.base_price,
              estimated_duration_minutes: item.estimated_duration_minutes,
            },
          },
          { upsert: true },
        )
        .exec();
    }
  }

  async create(payload: CreateServiceDto) {
    try {
      const service = await this.serviceModel.create({
        name: payload.name,
        is_active: true,
        base_price: payload.base_price,
        estimated_duration_minutes: payload.estimated_duration_minutes ?? null,
      });
      return this.serializeService(service);
    } catch (error) {
      if ((error as { code?: number }).code === 11000) {
        throw new ConflictException('Service name already exists');
      }
      throw error;
    }
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
    if (payload.name !== undefined) {
      service.name = payload.name;
    }
    if (payload.base_price !== undefined) {
      service.base_price = payload.base_price;
    }
    if (payload.estimated_duration_minutes !== undefined) {
      service.estimated_duration_minutes = payload.estimated_duration_minutes;
    }

    try {
      await service.save();
      return this.serializeService(service);
    } catch (error) {
      if ((error as { code?: number }).code === 11000) {
        throw new ConflictException('Service name already exists');
      }
      throw error;
    }
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
        const service = await this.serviceModel.findById(serviceId).session(session).exec();
        if (!service) {
          throw new NotFoundException('Service not found');
        }

        await this.serviceModel
          .updateOne(
            { _id: service._id },
            { $set: { is_active: false }, $inc: { __v: 1 } },
            { session, timestamps: false },
          )
          .exec();

        const usageCount = await this.jobServiceModel
          .countDocuments({ service_id: service._id })
          .session(session)
          .exec();

        if (usageCount > 0) {
          throw new ConflictException(
            'Service is already used on existing jobs. Deactivate it instead.',
          );
        }

        await this.serviceModel.deleteOne({ _id: service._id }, { session }).exec();
      });
    } finally {
      await session.endSession();
    }

    return { deleted: true };
  }
}
