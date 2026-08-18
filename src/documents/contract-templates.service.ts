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
import {
  CreateContractTemplateDto,
  UpdateContractTemplateDto,
} from './dto/contract-template-write.dto';
import {
  ContractTemplate,
  ContractTemplateDocument,
  DEFAULT_CONTRACT_TEMPLATE_BODY,
  DEFAULT_CONTRACT_TEMPLATE_NAME,
} from './schemas/contract-template.schema';

export type SerializedContractTemplate = {
  id: string;
  name: string;
  body: string;
  is_default: boolean;
  is_active: boolean;
  created_at?: string;
  updated_at?: string;
};

@Injectable()
export class ContractTemplatesService {
  constructor(
    @InjectModel(ContractTemplate.name)
    private readonly contractTemplateModel: Model<ContractTemplateDocument>,
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

  async ensureDefaultContractTemplate(
    organizationId: string,
  ): Promise<SerializedContractTemplate> {
    const organizationObjectId = asObjectId(organizationId, 'organization id');
    const normalizedName = this.normalizeName(DEFAULT_CONTRACT_TEMPLATE_NAME);

    const existingDefault = await this.contractTemplateModel
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

    const existingByName = await this.contractTemplateModel
      .findOne(
        withOrganizationScope(organizationId, {
          normalized_name: normalizedName,
        }),
      )
      .exec();
    if (existingByName) {
      existingByName.is_default = true;
      existingByName.is_active = true;
      if (!existingByName.body) {
        existingByName.body = DEFAULT_CONTRACT_TEMPLATE_BODY;
      }
      await existingByName.save();
      return this.serialize(existingByName);
    }

    const created = await this.contractTemplateModel.create({
      organization_id: organizationObjectId,
      name: DEFAULT_CONTRACT_TEMPLATE_NAME,
      normalized_name: normalizedName,
      body: DEFAULT_CONTRACT_TEMPLATE_BODY,
      is_default: true,
      is_active: true,
    });
    return this.serialize(created);
  }

  async findActive(
    organizationId: string,
  ): Promise<SerializedContractTemplate[]> {
    const templates = await this.contractTemplateModel
      .find(withOrganizationScope(organizationId, { is_active: true }))
      .sort({ is_default: -1, name: 1, _id: 1 })
      .exec();
    return templates.map((template) => this.serialize(template));
  }

  /** ADMIN catalog: includes inactive templates. */
  async findAll(organizationId: string): Promise<SerializedContractTemplate[]> {
    const templates = await this.contractTemplateModel
      .find(withOrganizationScope(organizationId, {}))
      .sort({ is_default: -1, is_active: -1, name: 1, _id: 1 })
      .exec();
    return templates.map((template) => this.serialize(template));
  }

  async findById(
    id: string,
    organizationId: string,
  ): Promise<SerializedContractTemplate> {
    const template = await this.contractTemplateModel
      .findOne(
        withOrganizationScope(organizationId, {
          _id: asObjectId(id, 'contract template id'),
        }),
      )
      .exec();
    if (!template) {
      throw new NotFoundException('Contract template not found');
    }
    return this.serialize(template);
  }

  async findActiveDocumentById(id: string, organizationId: string) {
    const template = await this.contractTemplateModel
      .findOne(
        withOrganizationScope(organizationId, {
          _id: asObjectId(id, 'contract template id'),
          is_active: true,
        }),
      )
      .exec();
    if (!template) {
      throw new NotFoundException('Contract template not found or inactive');
    }
    return template;
  }

  async create(
    payload: CreateContractTemplateDto,
    organizationId: string,
  ): Promise<SerializedContractTemplate> {
    const organizationObjectId = asObjectId(organizationId, 'organization id');
    const normalizedName = this.normalizeName(payload.name);

    try {
      const created = await this.contractTemplateModel.create({
        organization_id: organizationObjectId,
        name: payload.name.trim(),
        normalized_name: normalizedName,
        body: payload.body.trim(),
        is_default: false,
        is_active: true,
      });

      if (payload.is_default === true) {
        return this.setDefault(String(created._id), organizationId);
      }

      return this.serialize(created);
    } catch (error) {
      if (this.isDuplicateKeyError(error)) {
        throw new ConflictException(
          'A contract template with this name already exists',
        );
      }
      throw error;
    }
  }

  async update(
    id: string,
    payload: UpdateContractTemplateDto,
    organizationId: string,
  ): Promise<SerializedContractTemplate> {
    const objectId = asObjectId(id, 'contract template id');
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
    if (payload.body !== undefined) {
      $set.body = payload.body.trim();
    }
    if (payload.is_active !== undefined) {
      $set.is_active = payload.is_active;
      // Inactive templates cannot remain the org default.
      if (payload.is_active === false) {
        $set.is_default = false;
      }
    }

    let updated: ContractTemplateDocument | null = null;
    try {
      if (Object.keys($set).length > 0) {
        updated = await this.contractTemplateModel
          .findOneAndUpdate(filter, { $set }, { returnDocument: 'after' })
          .exec();
        if (!updated) {
          if (payload.expected_updated_at) {
            const exists = await this.contractTemplateModel
              .findOne(withOrganizationScope(organizationId, { _id: objectId }))
              .exec();
            if (exists) {
              throw new ConflictException({
                code: 'STALE_VERSION',
                message: 'Contract template was modified by another request',
              });
            }
          }
          throw new NotFoundException('Contract template not found');
        }
      } else {
        updated = await this.contractTemplateModel
          .findOne(withOrganizationScope(organizationId, { _id: objectId }))
          .exec();
        if (!updated) {
          throw new NotFoundException('Contract template not found');
        }
      }
    } catch (error) {
      if (this.isDuplicateKeyError(error)) {
        throw new ConflictException(
          'A contract template with this name already exists',
        );
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
  ): Promise<SerializedContractTemplate> {
    return this.update(id, { is_active: false }, organizationId);
  }

  async setDefault(
    id: string,
    organizationId: string,
  ): Promise<SerializedContractTemplate> {
    const objectId = asObjectId(id, 'contract template id');
    const session = await this.connection.startSession();

    try {
      let result: ContractTemplateDocument | null = null;
      await session.withTransaction(async () => {
        const target = await this.contractTemplateModel
          .findOne(
            withOrganizationScope(organizationId, {
              _id: objectId,
              is_active: true,
            }),
          )
          .session(session)
          .exec();
        if (!target) {
          throw new NotFoundException(
            'Contract template not found or inactive',
          );
        }

        await this.contractTemplateModel
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
        throw new NotFoundException('Contract template not found or inactive');
      }
      return this.serialize(result);
    } finally {
      await session.endSession();
    }
  }

  private serialize(
    template: ContractTemplateDocument,
  ): SerializedContractTemplate {
    return {
      id: String(template._id),
      name: template.name,
      body: template.body,
      is_default: template.is_default === true,
      is_active: template.is_active !== false,
      created_at: template.created_at?.toISOString?.() ?? undefined,
      updated_at: template.updated_at?.toISOString?.() ?? undefined,
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
