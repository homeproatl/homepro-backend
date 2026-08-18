import {
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleInit,
  Optional,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { asObjectId } from '../common/utils/object-id';
import { withOrganizationScope } from '../common/utils/organization-scope';
import {
  OrgDocument,
  OrgDocumentDocument,
} from '../documents/schemas/document.schema';
import { TaxRate, TaxRateDocument } from '../documents/schemas/tax-rate.schema';
import { CreateItemDto } from './dto/create-item.dto';
import { ListItemsQueryDto } from './dto/list-items-query.dto';
import { UpdateItemDto } from './dto/update-item.dto';
import { normalizeItemName, resolveItemWriteFields } from './item-write';
import { Item, ItemDocument, ITEM_FIELD_LIMITS } from './schemas/item.schema';

export type SerializedItem = {
  id: string;
  name: string;
  item_type: string;
  description_template: string | null;
  default_rate_minor: number;
  default_unit_of_measure: string | null;
  default_internal_unit_cost_minor?: number | null;
  default_vendor_name: string | null;
  default_sku_or_part_number: string | null;
  default_waste_basis_points: number;
  default_markup_type: string;
  default_markup_value: number;
  taxable_default: boolean;
  tax_ids: string[];
  category: string | null;
  private_notes: string | null;
  is_active: boolean;
  usage_count: number;
  source_rate_decimal?: string | null;
  source_metadata?: Item['source_metadata'];
  created_at?: string;
  updated_at?: string;
};

type SerializeOptions = {
  includeInternalFields?: boolean;
};

const MINIMAL_ITEMS: Array<{
  name: string;
  item_type: CreateItemDto['item_type'];
  description_template?: string | null;
  default_rate_minor: number;
  default_unit_of_measure?: string | null;
  default_internal_unit_cost_minor?: number | null;
  default_sku_or_part_number?: string | null;
  category?: string | null;
}> = [
  {
    name: 'General Labor',
    item_type: 'labor',
    description_template: 'Hourly construction labor',
    default_rate_minor: 8500,
    category: 'Labor',
  },
  {
    name: 'Construction Service',
    item_type: 'service',
    description_template: 'General contractor service',
    default_rate_minor: 15000,
    category: 'Services',
  },
  {
    name: 'Dimensional Lumber',
    item_type: 'material',
    description_template: 'Framing lumber',
    default_rate_minor: 850,
    default_unit_of_measure: 'each',
    default_internal_unit_cost_minor: 450,
    default_sku_or_part_number: null,
    category: 'Materials',
  },
];

@Injectable()
export class ItemsService implements OnModuleInit {
  private readonly logger = new Logger(ItemsService.name);

  constructor(
    @InjectModel(Item.name)
    private readonly itemModel: Model<ItemDocument>,
    @InjectModel(OrgDocument.name)
    private readonly documentModel: Model<OrgDocumentDocument>,
    @Optional()
    @InjectModel(TaxRate.name)
    private readonly taxRateModel?: Model<TaxRateDocument>,
  ) {}

  async onModuleInit() {
    await this.ensureItemIndexes();
  }

  private async ensureItemIndexes() {
    const collection = this.itemModel.collection;
    if (!collection || typeof collection.createIndex !== 'function') {
      return;
    }

    try {
      await collection.createIndex(
        { organization_id: 1, normalized_name: 1 },
        {
          unique: true,
          name: 'organization_id_1_normalized_name_1_native',
          partialFilterExpression: {
            source_metadata: { $type: 'null' },
          },
        },
      );
      await collection.createIndex(
        {
          organization_id: 1,
          'source_metadata.source_system': 1,
          'source_metadata.source_entity': 1,
          'source_metadata.source_id': 1,
        },
        {
          unique: true,
          partialFilterExpression: {
            'source_metadata.source_id': { $type: 'string' },
          },
          name: 'uniq_item_source_identity',
        },
      );
      await collection.createIndex(
        { organization_id: 1, is_active: 1, name: 1, _id: 1 },
        { name: 'organization_id_1_is_active_1_name_1__id_1' },
      );
      await collection.createIndex(
        { organization_id: 1, item_type: 1, is_active: 1 },
        { name: 'organization_id_1_item_type_1_is_active_1' },
      );
      await collection.createIndex(
        { organization_id: 1, category: 1, is_active: 1 },
        { name: 'organization_id_1_category_1_is_active_1' },
      );
    } catch (error) {
      this.logger.warn(
        `Unable to ensure item indexes: ${(error as Error).message}`,
      );
    }
  }

  async ensureMinimalCatalog(organizationId: string): Promise<void> {
    const organizationObjectId = asObjectId(organizationId, 'organization id');
    for (const item of MINIMAL_ITEMS) {
      const normalizedName = normalizeItemName(item.name);
      await this.itemModel
        .updateOne(
          withOrganizationScope(organizationId, {
            normalized_name: normalizedName,
          }),
          {
            $setOnInsert: {
              organization_id: organizationObjectId,
              name: item.name,
              normalized_name: normalizedName,
              item_type: item.item_type,
              description_template: item.description_template ?? null,
              default_rate_minor: item.default_rate_minor,
              default_unit_of_measure: item.default_unit_of_measure ?? null,
              default_internal_unit_cost_minor:
                item.default_internal_unit_cost_minor ?? null,
              default_vendor_name: null,
              default_sku_or_part_number:
                item.default_sku_or_part_number ?? null,
              default_waste_basis_points: 0,
              default_markup_type: 'none',
              default_markup_value: 0,
              taxable_default: false,
              category: item.category ?? null,
              is_active: true,
            },
          },
          { upsert: true },
        )
        .exec();
    }
  }

  async create(
    payload: CreateItemDto,
    organizationId: string,
    options: SerializeOptions = {},
  ) {
    const name = payload.name.trim();
    const normalizedName = normalizeItemName(name);
    await this.assertUniqueName(normalizedName, organizationId);

    const resolvedFields = resolveItemWriteFields(payload);
    await this.assertTaxIdsBelongToOrganization(
      resolvedFields.tax_ids,
      organizationId,
    );
    const fields = this.prepareItemWriteFields(resolvedFields);
    const item = await this.itemModel.create({
      organization_id: asObjectId(organizationId, 'organization id'),
      name,
      normalized_name: normalizedName,
      is_active: true,
      ...fields,
    });

    return this.serializeItem(item, organizationId, options);
  }

  async findAll(
    query: ListItemsQueryDto = {},
    organizationId: string,
    options: SerializeOptions = {},
  ) {
    const items = await this.itemModel
      .find(this.buildSearchQuery(query, organizationId))
      .sort({ is_active: -1, name: 1, _id: 1 })
      .exec();
    return this.serializeItems(items, organizationId, options);
  }

  async findPage(
    query: ListItemsQueryDto = {},
    organizationId: string,
    options: SerializeOptions = {},
  ) {
    const searchQuery = this.buildSearchQuery(query, organizationId);
    const page = query.page ?? 1;
    const pageSize = Math.min(
      query.page_size ?? 25,
      ITEM_FIELD_LIMITS.page_size_max,
    );
    const total = await this.itemModel.countDocuments(searchQuery).exec();
    const pageCount = total === 0 ? 1 : Math.ceil(total / pageSize);
    const currentPage = Math.min(Math.max(page, 1), pageCount);
    const skip = (currentPage - 1) * pageSize;

    const items = await this.itemModel
      .find(searchQuery)
      .sort({ is_active: -1, name: 1, _id: 1 })
      .skip(skip)
      .limit(pageSize)
      .exec();

    return {
      items: await this.serializeItems(items, organizationId, options),
      total,
      page: currentPage,
      page_size: pageSize,
      page_count: pageCount,
    };
  }

  async findById(
    id: string,
    organizationId: string,
    options: SerializeOptions = {},
  ) {
    const item = await this.findDocumentById(id, organizationId);
    return this.serializeItem(item, organizationId, options);
  }

  async update(
    id: string,
    payload: UpdateItemDto,
    organizationId: string,
    options: SerializeOptions = {},
  ) {
    const item = await this.findDocumentById(id, organizationId);
    const nextName =
      payload.name !== undefined ? payload.name.trim() : item.name;
    const nextNormalized = normalizeItemName(nextName);

    if (payload.name !== undefined) {
      await this.assertUniqueName(nextNormalized, organizationId, {
        excludeId: id,
      });
      item.name = nextName;
      item.normalized_name = nextNormalized;
    }

    const resolvedFields = resolveItemWriteFields(payload, {
      item_type: item.item_type,
      description_template: item.description_template,
      default_rate_minor: item.default_rate_minor,
      default_unit_of_measure: item.default_unit_of_measure,
      default_internal_unit_cost_minor: item.default_internal_unit_cost_minor,
      default_vendor_name: item.default_vendor_name,
      default_sku_or_part_number: item.default_sku_or_part_number,
      default_waste_basis_points: item.default_waste_basis_points,
      default_markup_type: item.default_markup_type,
      default_markup_value: item.default_markup_value,
      taxable_default: item.taxable_default,
      tax_ids: (item.tax_ids ?? []).map((taxId) => String(taxId)),
      category: item.category,
      private_notes: item.private_notes,
    });
    await this.assertTaxIdsBelongToOrganization(
      resolvedFields.tax_ids,
      organizationId,
    );
    const fields = this.prepareItemWriteFields(resolvedFields);

    Object.assign(item, fields);
    await item.save();
    return this.serializeItem(item, organizationId, options);
  }

  async deactivate(
    id: string,
    organizationId: string,
    options: SerializeOptions = {},
  ) {
    const item = await this.findDocumentById(id, organizationId);
    if (item.is_active === false) {
      return this.serializeItem(item, organizationId, options);
    }
    item.is_active = false;
    await item.save();
    return this.serializeItem(item, organizationId, options);
  }

  async reactivate(
    id: string,
    organizationId: string,
    options: SerializeOptions = {},
  ) {
    const item = await this.findDocumentById(id, organizationId);
    if (item.is_active !== false) {
      return this.serializeItem(item, organizationId, options);
    }
    item.is_active = true;
    await item.save();
    return this.serializeItem(item, organizationId, options);
  }

  async remove(id: string, organizationId: string) {
    const itemId = asObjectId(id, 'item id');
    const session = await this.itemModel.db.startSession();

    try {
      await session.withTransaction(async () => {
        const item = await this.itemModel
          .findOne(
            withOrganizationScope(organizationId, {
              _id: itemId,
            }),
          )
          .session(session)
          .exec();
        if (!item) {
          throw new NotFoundException('Item not found');
        }

        const usageCount = await this.countItemReferences(
          item._id,
          organizationId,
          session,
        );

        if (usageCount > 0) {
          throw new ConflictException(
            'Item is already used on existing documents. Deactivate it instead.',
          );
        }

        await this.itemModel.deleteOne({ _id: item._id }, { session }).exec();
      });
    } finally {
      await session.endSession();
    }

    return { deleted: true };
  }

  private async countItemReferences(
    itemId: ItemDocument['_id'],
    organizationId: string,
    session?: unknown,
  ) {
    const documentQuery = withOrganizationScope(organizationId, {
      'line_items.item_id': itemId,
    });

    const documentCountQuery = this.documentModel.countDocuments(documentQuery);
    if (
      session &&
      typeof (documentCountQuery as { session?: (value: unknown) => unknown })
        .session === 'function'
    ) {
      return (
        documentCountQuery as {
          session: (value: unknown) => { exec: () => Promise<number> };
        }
      )
        .session(session)
        .exec();
    }
    return documentCountQuery.exec();
  }

  private async assertUniqueName(
    normalizedName: string,
    organizationId: string,
    options?: { excludeId?: string },
  ) {
    const query: Record<string, unknown> = withOrganizationScope(
      organizationId,
      {
        normalized_name: normalizedName,
      },
    );
    if (options?.excludeId) {
      query._id = { $ne: asObjectId(options.excludeId, 'item id') };
    }

    const existing = await this.itemModel.findOne(query).exec();
    if (existing) {
      throw new ConflictException({
        code: 'DUPLICATE_ITEM_NAME',
        message: 'An item with this name already exists.',
        duplicate_item: {
          id: String(existing._id),
          name: existing.name,
          is_active: existing.is_active !== false,
        },
      });
    }
  }

  private async findDocumentById(id: string, organizationId: string) {
    const item = await this.itemModel
      .findOne(
        withOrganizationScope(organizationId, {
          _id: asObjectId(id, 'item id'),
        }),
      )
      .exec();
    if (!item) {
      throw new NotFoundException('Item not found');
    }
    return item;
  }

  private async getUsageCounts(
    itemIds: Array<ItemDocument['_id']>,
    organizationId: string,
  ): Promise<Map<string, number>> {
    if (itemIds.length === 0) {
      return new Map();
    }

    const counts = await this.documentModel
      .aggregate<{ _id: ItemDocument['_id']; count: number }>([
        {
          $match: withOrganizationScope(organizationId, {
            'line_items.item_id': { $in: itemIds },
          }),
        },
        { $unwind: '$line_items' },
        {
          $match: {
            'line_items.item_id': { $in: itemIds },
          },
        },
        {
          $group: {
            _id: '$line_items.item_id',
            count: { $sum: 1 },
          },
        },
      ])
      .exec();

    return new Map(counts.map((entry) => [String(entry._id), entry.count]));
  }

  private async serializeItems(
    items: ItemDocument[],
    organizationId: string,
    options: SerializeOptions,
  ) {
    const usageCounts = await this.getUsageCounts(
      items.map((item) => item._id),
      organizationId,
    );
    return items.map((item) =>
      this.serializeItemSync(
        item,
        usageCounts.get(String(item._id)) ?? 0,
        options,
      ),
    );
  }

  private async serializeItem(
    item: ItemDocument,
    organizationId: string,
    options: SerializeOptions,
  ) {
    const usageCount = await this.countItemReferences(item._id, organizationId);
    return this.serializeItemSync(item, usageCount, options);
  }

  private serializeItemSync(
    item: ItemDocument,
    usageCount: number,
    options: SerializeOptions,
  ): SerializedItem {
    const raw = item.toObject() as unknown as Record<string, unknown> & {
      _id?: unknown;
      created_at?: Date | string;
      updated_at?: Date | string;
    };

    const taxIds = Array.isArray(item.tax_ids)
      ? item.tax_ids.map((taxId) => String(taxId))
      : [];
    const taxableDefault = item.taxable_default !== false && taxIds.length > 0;
    const serialized: SerializedItem = {
      id: this.serializeId(raw._id, 'item id'),
      name: item.name,
      item_type: item.item_type,
      description_template: item.description_template,
      default_rate_minor: item.default_rate_minor,
      default_unit_of_measure: item.default_unit_of_measure,
      default_vendor_name: item.default_vendor_name,
      default_sku_or_part_number: item.default_sku_or_part_number,
      default_waste_basis_points: item.default_waste_basis_points,
      default_markup_type: item.default_markup_type,
      default_markup_value: item.default_markup_value,
      taxable_default: taxableDefault,
      tax_ids: taxableDefault ? taxIds : [],
      category: item.category,
      private_notes: item.private_notes,
      is_active: item.is_active !== false,
      usage_count: usageCount,
      created_at: this.toIsoString(raw.created_at),
      updated_at: this.toIsoString(raw.updated_at),
    };

    if (options.includeInternalFields !== false) {
      serialized.default_internal_unit_cost_minor =
        item.default_internal_unit_cost_minor;
      serialized.source_rate_decimal = item.source_rate_decimal ?? null;
      serialized.source_metadata = item.source_metadata ?? null;
    }

    return serialized;
  }

  private buildSearchQuery(query: ListItemsQueryDto, organizationId: string) {
    const filter: Record<string, unknown> = {};

    if (query.item_type) {
      filter.item_type = query.item_type;
    }
    if (query.category) {
      filter.category = {
        $regex: this.escapeRegex(query.category.trim()),
        $options: 'i',
      };
    }
    if (query.is_active !== undefined) {
      filter.is_active = query.is_active;
    }
    if (query.taxable !== undefined) {
      filter.taxable_default = query.taxable;
    }

    if (query.search) {
      const tokens = query.search
        .trim()
        .split(/\s+/)
        .filter(Boolean)
        .slice(0, ITEM_FIELD_LIMITS.search_token_max);
      if (tokens.length > 0) {
        filter.$and = tokens.map((token) => {
          const pattern = this.escapeRegex(token);
          return {
            $or: [
              { name: { $regex: pattern, $options: 'i' } },
              { description_template: { $regex: pattern, $options: 'i' } },
              { category: { $regex: pattern, $options: 'i' } },
              {
                default_sku_or_part_number: { $regex: pattern, $options: 'i' },
              },
              { default_vendor_name: { $regex: pattern, $options: 'i' } },
            ],
          };
        });
      }
    }

    return withOrganizationScope(organizationId, filter);
  }

  private async assertTaxIdsBelongToOrganization(
    taxIds: string[] | undefined,
    organizationId: string,
  ) {
    if (!taxIds || taxIds.length === 0 || !this.taxRateModel) {
      return;
    }
    const uniqueIds = [...new Set(taxIds)];
    const objectIds = uniqueIds.map((id) => asObjectId(id, 'tax id'));
    const count = await this.taxRateModel
      .countDocuments(
        withOrganizationScope(organizationId, {
          _id: { $in: objectIds },
          is_active: true,
        }),
      )
      .exec();
    if (count !== uniqueIds.length) {
      throw new NotFoundException(
        'One or more selected tax rates were not found.',
      );
    }
  }

  private prepareItemWriteFields<T extends { tax_ids?: string[] }>(fields: T) {
    return {
      ...fields,
      tax_ids: [...new Set(fields.tax_ids ?? [])].map((taxId) =>
        asObjectId(taxId, 'tax id'),
      ),
    };
  }

  private escapeRegex(value: string) {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  private serializeId(value: unknown, context: string) {
    if (typeof value === 'string' && value.length > 0) {
      return value;
    }
    if (
      value &&
      typeof value === 'object' &&
      typeof (value as { toString?: unknown }).toString === 'function'
    ) {
      const serialized = (value as { toString: () => string }).toString();
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
}
