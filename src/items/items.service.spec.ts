import { ConflictException, NotFoundException } from '@nestjs/common';
import { ItemsService } from './items.service';

function createSessionMock() {
  return {
    withTransaction: jest.fn(async (callback: () => Promise<unknown>) =>
      callback(),
    ),
    endSession: jest.fn().mockResolvedValue(undefined),
  };
}

function createSessionExecMock<T>(value: T) {
  return {
    session: jest.fn().mockReturnThis(),
    exec: jest.fn().mockResolvedValue(value),
  };
}

function createDocumentModelMock(count = 0) {
  return {
    countDocuments: jest.fn().mockReturnValue(createSessionExecMock(count)),
  };
}

describe('ItemsService', () => {
  const organizationId = '507f1f77bcf86cd7994390aa';

  it('ensures organization-scoped item indexes on init', async () => {
    const createIndex = jest.fn().mockResolvedValue(undefined);
    const service = new ItemsService(
      {
        collection: { createIndex },
      } as never,
      {} as never,
      createDocumentModelMock() as never,
    );

    await service.onModuleInit();

    expect(createIndex).toHaveBeenCalledWith(
      { organization_id: 1, normalized_name: 1 },
      expect.objectContaining({ unique: true }),
    );
    expect(createIndex).toHaveBeenCalledWith(
      { organization_id: 1, item_type: 1, is_active: 1 },
      expect.any(Object),
    );
  });

  it('upserts minimal contractor catalog entries idempotently', async () => {
    const exec = jest.fn<Promise<void>, []>().mockResolvedValue(undefined);
    const updateOne = jest.fn().mockReturnValue({ exec });
    const service = new ItemsService(
      { updateOne } as never,
      {} as never,
      createDocumentModelMock() as never,
    );

    await service.ensureMinimalCatalog(organizationId);

    expect(updateOne).toHaveBeenCalledTimes(3);
    const firstCall = updateOne.mock.calls[0] as [
      Record<string, unknown>,
      { $setOnInsert: Record<string, unknown> },
      { upsert: boolean },
    ];
    expect(firstCall[0]).toEqual(
      expect.objectContaining({
        normalized_name: 'general labor',
      }),
    );
    expect(firstCall[0]).toHaveProperty('organization_id');
    expect(firstCall[1].$setOnInsert).toEqual(
      expect.objectContaining({
        name: 'General Labor',
        item_type: 'labor',
        default_rate_minor: 8500,
      }),
    );
  });

  it('creates items with normalized unique names and serializes usage', async () => {
    const created = {
      _id: 'item-1',
      name: 'Plywood',
      item_type: 'material',
      description_template: null,
      default_rate_minor: 4500,
      default_unit_of_measure: 'each',
      default_internal_unit_cost_minor: 2800,
      default_vendor_name: null,
      default_sku_or_part_number: null,
      default_waste_basis_points: 0,
      default_markup_type: 'none',
      default_markup_value: 0,
      taxable_default: true,
      category: 'Materials',
      is_active: true,
      toObject: () => ({
        _id: 'item-1',
        created_at: new Date('2026-01-01T00:00:00.000Z'),
        updated_at: new Date('2026-01-01T00:00:00.000Z'),
      }),
    };

    const service = new ItemsService(
      {
        findOne: jest.fn().mockReturnValue({
          exec: jest.fn().mockResolvedValue(null),
        }),
        create: jest.fn().mockResolvedValue(created),
      } as never,
      {
        countDocuments: jest.fn().mockReturnValue({
          exec: jest.fn().mockResolvedValue(0),
        }),
      } as never,
      createDocumentModelMock() as never,
    );

    const result = await service.create(
      {
        name: 'Plywood',
        item_type: 'material',
        default_rate_minor: 4500,
        default_unit_of_measure: 'each',
        default_internal_unit_cost_minor: 2800,
        category: 'Materials',
      },
      organizationId,
    );

    expect(result).toEqual(
      expect.objectContaining({
        id: 'item-1',
        name: 'Plywood',
        item_type: 'material',
        default_rate_minor: 4500,
        usage_count: 0,
      }),
    );
  });

  it('scopes findById and rejects foreign organization ids', async () => {
    const service = new ItemsService(
      {
        findOne: jest.fn().mockReturnValue({
          exec: jest.fn().mockResolvedValue(null),
        }),
      } as never,
      {} as never,
      createDocumentModelMock() as never,
    );

    await expect(
      service.findById('507f1f77bcf86cd7994390ab', organizationId),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('paginates and clamps out-of-range pages', async () => {
    const limit = jest.fn().mockReturnValue({
      exec: jest.fn().mockResolvedValue([]),
    });
    const find = jest.fn().mockReturnValue({
      sort: jest.fn().mockReturnValue({
        skip: jest.fn().mockReturnValue({
          limit,
        }),
      }),
    });
    const service = new ItemsService(
      {
        find,
        countDocuments: jest.fn().mockReturnValue({
          exec: jest.fn().mockResolvedValue(30),
        }),
      } as never,
      {
        aggregate: jest.fn().mockReturnValue({
          exec: jest.fn().mockResolvedValue([]),
        }),
      } as never,
      createDocumentModelMock() as never,
    );

    const page = await service.findPage(
      { page: 99, page_size: 25 },
      organizationId,
    );

    expect(page.page).toBe(2);
    expect(page.page_count).toBe(2);
    expect(page.total).toBe(30);
    expect(limit).toHaveBeenCalledWith(25);
  });

  it('caps page size in the service layer even when DTO validation is bypassed', async () => {
    const limit = jest.fn().mockReturnValue({
      exec: jest.fn().mockResolvedValue([]),
    });
    const find = jest.fn().mockReturnValue({
      sort: jest.fn().mockReturnValue({
        skip: jest.fn().mockReturnValue({ limit }),
      }),
    });
    const service = new ItemsService(
      {
        find,
        countDocuments: jest.fn().mockReturnValue({
          exec: jest.fn().mockResolvedValue(0),
        }),
      } as never,
      {
        aggregate: jest.fn().mockReturnValue({
          exec: jest.fn().mockResolvedValue([]),
        }),
      } as never,
      createDocumentModelMock() as never,
    );

    await service.findPage({ page: 1, page_size: 500 }, organizationId);

    expect(limit).toHaveBeenCalledWith(100);
  });

  it('scopes item usage aggregates to the authenticated organization', async () => {
    const itemId = '507f1f77bcf86cd7994390ab';
    const item = {
      _id: itemId,
      name: 'Plywood',
      item_type: 'material',
      description_template: null,
      default_rate_minor: 4500,
      default_unit_of_measure: 'each',
      default_internal_unit_cost_minor: 2800,
      default_vendor_name: null,
      default_sku_or_part_number: null,
      default_waste_basis_points: 0,
      default_markup_type: 'none',
      default_markup_value: 0,
      taxable_default: true,
      category: null,
      is_active: true,
      toObject: () => ({ _id: itemId }),
    };
    let capturedPipeline: Array<Record<string, unknown>> = [];
    const aggregate = jest.fn((pipeline: Array<Record<string, unknown>>) => {
      capturedPipeline = pipeline;
      return {
        exec: jest.fn().mockResolvedValue([{ _id: itemId, count: 3 }]),
      };
    });
    const service = new ItemsService(
      {
        find: jest.fn().mockReturnValue({
          sort: jest.fn().mockReturnValue({
            exec: jest.fn().mockResolvedValue([item]),
          }),
        }),
      } as never,
      { aggregate } as never,
      createDocumentModelMock() as never,
    );

    const results = await service.findAll({}, organizationId);
    expect(results[0]?.usage_count).toBe(3);
    const matchStage = capturedPipeline.find(
      (stage) => stage.$match && typeof stage.$match === 'object',
    ) as { $match: Record<string, unknown> } | undefined;
    expect(matchStage?.$match.organization_id).toBeDefined();
    expect(matchStage?.$match['line_items.item_id']).toEqual({
      $in: [itemId],
    });
  });

  it('omits internal unit cost when includeInternalFields is false', async () => {
    const itemId = '507f1f77bcf86cd7994390ab';
    const item = {
      _id: itemId,
      name: 'Plywood',
      item_type: 'material',
      description_template: null,
      default_rate_minor: 4500,
      default_unit_of_measure: 'each',
      default_internal_unit_cost_minor: 2800,
      default_vendor_name: null,
      default_sku_or_part_number: null,
      default_waste_basis_points: 0,
      default_markup_type: 'none',
      default_markup_value: 0,
      taxable_default: true,
      category: null,
      is_active: true,
      toObject: () => ({ _id: itemId }),
    };

    const service = new ItemsService(
      {
        findOne: jest.fn().mockReturnValue({
          exec: jest.fn().mockResolvedValue(item),
        }),
      } as never,
      {
        countDocuments: jest.fn().mockReturnValue({
          exec: jest.fn().mockResolvedValue(0),
        }),
      } as never,
      createDocumentModelMock() as never,
    );

    const result = await service.findById(itemId, organizationId, {
      includeInternalFields: false,
    });

    expect(result.default_internal_unit_cost_minor).toBeUndefined();
    expect(result.default_rate_minor).toBe(4500);
  });

  it('blocks hard delete when the item is referenced by documents', async () => {
    const session = createSessionMock();
    const item = { _id: 'item-1' };
    let capturedFilter: Record<string, unknown> = {};
    const countDocuments = jest.fn((filter: Record<string, unknown>) => {
      capturedFilter = filter;
      return createSessionExecMock(2);
    });
    const service = new ItemsService(
      {
        db: {
          startSession: jest.fn().mockResolvedValue(session),
        },
        findOne: jest.fn().mockReturnValue(createSessionExecMock(item)),
        deleteOne: jest.fn(),
      } as never,
      {
        countDocuments,
      } as never,
      createDocumentModelMock() as never,
    );

    await expect(
      service.remove('507f1f77bcf86cd7994390ab', organizationId),
    ).rejects.toBeInstanceOf(ConflictException);

    expect(capturedFilter['line_items.item_id']).toBe('item-1');
    expect(capturedFilter.organization_id).toBeDefined();
  });
});
