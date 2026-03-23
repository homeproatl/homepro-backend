import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
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

@Injectable()
export class ServiceCatalogService {
  constructor(
    @InjectModel(ServiceCatalog.name)
    private readonly serviceModel: Model<ServiceCatalogDocument>,
  ) {}

  async ensureMinimalCatalog(): Promise<void> {
    for (const item of MINIMAL_SERVICES) {
      await this.serviceModel
        .updateOne(
          { name: item.name },
          {
            $setOnInsert: {
              name: item.name,
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
      return await this.serviceModel.create({
        name: payload.name,
        base_price: payload.base_price,
        estimated_duration_minutes: payload.estimated_duration_minutes ?? null,
      });
    } catch (error) {
      if ((error as { code?: number }).code === 11000) {
        throw new ConflictException('Service name already exists');
      }
      throw error;
    }
  }

  async findAll() {
    return this.serviceModel.find().sort({ name: 1 }).exec();
  }

  async findById(id: string) {
    const service = await this.serviceModel
      .findById(asObjectId(id, 'service id'))
      .exec();
    if (!service) {
      throw new NotFoundException('Service not found');
    }

    return service;
  }

  async update(id: string, payload: UpdateServiceDto) {
    const service = await this.findById(id);
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
      return service;
    } catch (error) {
      if ((error as { code?: number }).code === 11000) {
        throw new ConflictException('Service name already exists');
      }
      throw error;
    }
  }
}
