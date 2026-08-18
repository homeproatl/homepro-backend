import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import { Connection, Model } from 'mongoose';
import { asObjectId } from '../common/utils/object-id';
import { withOrganizationScope } from '../common/utils/organization-scope';
import { CreateTaxRateDto, UpdateTaxRateDto } from './dto/tax-rate-write.dto';
import {
  DEFAULT_TAX_RATE_BASIS_POINTS,
  DEFAULT_TAX_RATE_NAME,
  TaxRate,
  TaxRateDocument,
} from './schemas/tax-rate.schema';

export type SerializedTaxRate = {
  id: string;
  name: string;
  rate_basis_points: number;
  is_default: boolean;
  is_active: boolean;
  created_at?: string;
  updated_at?: string;
};

@Injectable()
export class TaxRatesService {
  constructor(
    @InjectModel(TaxRate.name)
    private readonly taxRateModel: Model<TaxRateDocument>,
    @InjectConnection()
    private readonly connection: Connection,
  ) {}

  normalizeName(name: string) {
    return name
      .trim()
      .toLowerCase()
      .replace(/[-_]+/g, ' ')
      .replace(/\s+/g, ' ');
  }

  async ensureDefaultTaxRate(
    organizationId: string,
  ): Promise<SerializedTaxRate> {
    const organizationObjectId = asObjectId(organizationId, 'organization id');
    const normalizedName = this.normalizeName(DEFAULT_TAX_RATE_NAME);

    const existingDefault = await this.taxRateModel
      .findOne(
        withOrganizationScope(organizationId, {
          is_default: true,
          is_active: true,
        }),
      )
      .exec();
    if (existingDefault) {
      return this.serialize(existingDefault);
    }

    const existingByName = await this.taxRateModel
      .findOne(
        withOrganizationScope(organizationId, {
          normalized_name: normalizedName,
        }),
      )
      .exec();
    if (existingByName) {
      existingByName.is_default = true;
      existingByName.is_active = true;
      existingByName.rate_basis_points = DEFAULT_TAX_RATE_BASIS_POINTS;
      await existingByName.save();
      return this.serialize(existingByName);
    }

    const created = await this.taxRateModel.create({
      organization_id: organizationObjectId,
      name: DEFAULT_TAX_RATE_NAME,
      normalized_name: normalizedName,
      rate_basis_points: DEFAULT_TAX_RATE_BASIS_POINTS,
      is_default: true,
      is_active: true,
    });
    return this.serialize(created);
  }

  async findActive(organizationId: string): Promise<SerializedTaxRate[]> {
    const rates = await this.taxRateModel
      .find(withOrganizationScope(organizationId, { is_active: true }))
      .sort({ is_default: -1, name: 1, _id: 1 })
      .exec();
    return rates.map((rate) => this.serialize(rate));
  }

  /** ADMIN catalog: includes inactive rates. */
  async findAll(organizationId: string): Promise<SerializedTaxRate[]> {
    const rates = await this.taxRateModel
      .find(withOrganizationScope(organizationId, {}))
      .sort({ is_default: -1, is_active: -1, name: 1, _id: 1 })
      .exec();
    return rates.map((rate) => this.serialize(rate));
  }

  async findById(
    id: string,
    organizationId: string,
  ): Promise<SerializedTaxRate> {
    const rate = await this.taxRateModel
      .findOne(
        withOrganizationScope(organizationId, {
          _id: asObjectId(id, 'tax rate id'),
        }),
      )
      .exec();
    if (!rate) {
      throw new NotFoundException('Tax rate not found');
    }
    return this.serialize(rate);
  }

  async findActiveDocumentById(id: string, organizationId: string) {
    const rate = await this.taxRateModel
      .findOne(
        withOrganizationScope(organizationId, {
          _id: asObjectId(id, 'tax rate id'),
          is_active: true,
        }),
      )
      .exec();
    if (!rate) {
      throw new NotFoundException('Tax rate not found or inactive');
    }
    return rate;
  }

  async findActiveDocumentsByIds(ids: string[], organizationId: string) {
    const uniqueIds = [...new Set(ids.filter(Boolean))];
    if (uniqueIds.length === 0) {
      return [];
    }

    const objectIds = uniqueIds.map((id) => asObjectId(id, 'tax rate id'));
    const rates = await this.taxRateModel
      .find(
        withOrganizationScope(organizationId, {
          _id: { $in: objectIds },
          is_active: true,
        }),
      )
      .exec();

    if (rates.length !== uniqueIds.length) {
      throw new NotFoundException(
        'One or more tax rates were not found or inactive',
      );
    }

    const byId = new Map(rates.map((rate) => [String(rate._id), rate]));
    return uniqueIds
      .map((id) => byId.get(id))
      .filter(Boolean) as TaxRateDocument[];
  }

  async create(
    payload: CreateTaxRateDto,
    organizationId: string,
  ): Promise<SerializedTaxRate> {
    const organizationObjectId = asObjectId(organizationId, 'organization id');
    const normalizedName = this.normalizeName(payload.name);

    try {
      const created = await this.taxRateModel.create({
        organization_id: organizationObjectId,
        name: payload.name.trim(),
        normalized_name: normalizedName,
        rate_basis_points: payload.rate_basis_points,
        is_default: false,
        is_active: true,
      });

      if (payload.is_default === true) {
        return this.setDefault(String(created._id), organizationId);
      }

      return this.serialize(created);
    } catch (error) {
      if (this.isDuplicateKeyError(error)) {
        throw new ConflictException('A tax rate with this name already exists');
      }
      throw error;
    }
  }

  async update(
    id: string,
    payload: UpdateTaxRateDto,
    organizationId: string,
  ): Promise<SerializedTaxRate> {
    const objectId = asObjectId(id, 'tax rate id');
    const filter: Record<string, unknown> = withOrganizationScope(
      organizationId,
      { _id: objectId },
    );

    if (payload.expected_updated_at) {
      const expected = new Date(payload.expected_updated_at);
      if (Number.isNaN(expected.getTime())) {
        throw new BadRequestException('Invalid expected_updated_at');
      }
      filter.updated_at = expected;
    }

    const $set: Record<string, unknown> = {};
    if (payload.name !== undefined) {
      $set.name = payload.name.trim();
      $set.normalized_name = this.normalizeName(payload.name);
    }
    if (payload.rate_basis_points !== undefined) {
      $set.rate_basis_points = payload.rate_basis_points;
    }
    if (payload.is_active !== undefined) {
      $set.is_active = payload.is_active;
      // Inactive rates cannot remain the org default.
      if (payload.is_active === false) {
        $set.is_default = false;
      }
    }

    let updated: TaxRateDocument | null = null;
    try {
      if (Object.keys($set).length > 0) {
        updated = await this.taxRateModel
          .findOneAndUpdate(filter, { $set }, { returnDocument: 'after' })
          .exec();
        if (!updated) {
          if (payload.expected_updated_at) {
            const exists = await this.taxRateModel
              .findOne(withOrganizationScope(organizationId, { _id: objectId }))
              .exec();
            if (exists) {
              throw new ConflictException({
                code: 'STALE_VERSION',
                message: 'Tax rate was modified by another request',
              });
            }
          }
          throw new NotFoundException('Tax rate not found');
        }
      } else {
        updated = await this.taxRateModel
          .findOne(withOrganizationScope(organizationId, { _id: objectId }))
          .exec();
        if (!updated) {
          throw new NotFoundException('Tax rate not found');
        }
      }
    } catch (error) {
      if (this.isDuplicateKeyError(error)) {
        throw new ConflictException('A tax rate with this name already exists');
      }
      throw error;
    }

    if (payload.is_default === true) {
      return this.setDefault(id, organizationId);
    }

    if (payload.is_default === false && updated.is_default) {
      updated.is_default = false;
      await updated.save();
    }

    return this.serialize(updated);
  }

  async deactivate(
    id: string,
    organizationId: string,
  ): Promise<SerializedTaxRate> {
    return this.update(id, { is_active: false }, organizationId);
  }

  async setDefault(
    id: string,
    organizationId: string,
  ): Promise<SerializedTaxRate> {
    const objectId = asObjectId(id, 'tax rate id');
    const session = await this.connection.startSession();

    try {
      let result: TaxRateDocument | null = null;
      await session.withTransaction(async () => {
        const target = await this.taxRateModel
          .findOne(
            withOrganizationScope(organizationId, {
              _id: objectId,
              is_active: true,
            }),
          )
          .session(session)
          .exec();
        if (!target) {
          throw new NotFoundException('Tax rate not found or inactive');
        }

        await this.taxRateModel
          .updateMany(
            withOrganizationScope(organizationId, {
              is_default: true,
              _id: { $ne: objectId },
            }),
            { $set: { is_default: false } },
            { session },
          )
          .exec();

        target.is_default = true;
        target.is_active = true;
        await target.save({ session });
        result = target;
      });

      if (!result) {
        throw new NotFoundException('Tax rate not found or inactive');
      }
      return this.serialize(result);
    } finally {
      await session.endSession();
    }
  }

  private serialize(rate: TaxRateDocument): SerializedTaxRate {
    return {
      id: String(rate._id),
      name: rate.name,
      rate_basis_points: rate.rate_basis_points,
      is_default: rate.is_default === true,
      is_active: rate.is_active !== false,
      created_at: rate.created_at?.toISOString?.() ?? undefined,
      updated_at: rate.updated_at?.toISOString?.() ?? undefined,
    };
  }

  private isDuplicateKeyError(error: unknown): boolean {
    return (
      !!error &&
      typeof error === 'object' &&
      (error as { code?: number }).code === 11000
    );
  }
}
