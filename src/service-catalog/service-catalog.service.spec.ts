import { BadRequestException, ConflictException } from '@nestjs/common';
import { ServiceCatalogService } from './service-catalog.service';

function createSessionMock() {
  return {
    withTransaction: jest.fn(async (callback: () => Promise<unknown>) => callback()),
    endSession: jest.fn().mockResolvedValue(undefined),
  };
}

function createSessionExecMock<T>(value: T) {
  return {
    session: jest.fn().mockReturnThis(),
    exec: jest.fn().mockResolvedValue(value),
  };
}

describe('ServiceCatalogService', () => {
  it('ensures the normalized-name index for canned-service duplicate checks', async () => {
    const createIndex = jest.fn().mockResolvedValue(undefined);

    const service = new ServiceCatalogService(
      {
        collection: {
          createIndex,
        },
      } as never,
      {} as never,
    );

    await service.onModuleInit();

    expect(createIndex).toHaveBeenCalledWith(
      { normalized_name: 1 },
      { name: 'normalized_name_1' },
    );
  });

  it('upserts minimal catalog entries idempotently', async () => {
    const exec = jest.fn<Promise<void>, []>().mockResolvedValue(undefined);
    const updateOne = jest.fn().mockReturnValue({ exec });
    const service = new ServiceCatalogService(
      { updateOne } as never,
      {} as never,
    );

    await service.ensureMinimalCatalog();

    expect(updateOne).toHaveBeenCalledTimes(2);
    const [filter, update, options] = updateOne.mock.calls[0] as [
      { normalized_name: string },
      {
        $setOnInsert: {
          name: string;
          normalized_name: string;
          labor_lines: Array<{ description: string; subtotal: number }>;
          part_lines: Array<{ name: string; subtotal: number }>;
          labor_total: number;
          parts_total: number;
          total: number;
        };
      },
      { upsert: boolean },
    ];
    expect(filter).toEqual({ normalized_name: 'oil change' });
    expect(update.$setOnInsert).toEqual(
      expect.objectContaining({
        name: 'Oil Change',
        normalized_name: 'oil change',
        labor_total: 60,
        parts_total: 45,
        total: 105,
      }),
    );
    expect(options).toEqual({ upsert: true });
  });

  it('serializes service list usage counts with a single aggregate query', async () => {
    const aggregate = jest.fn().mockReturnValue({
      exec: jest.fn().mockResolvedValue([
        { _id: 'service-1', count: 2 },
        { _id: 'service-2', count: 0 },
      ]),
    });
    const service = new ServiceCatalogService(
      {
        find: jest.fn().mockReturnValue({
          sort: jest.fn().mockReturnValue({
            exec: jest.fn().mockResolvedValue([
              {
                _id: 'service-1',
                is_active: true,
                toObject: () => ({
                  _id: 'service-1',
                  name: 'Oil Change',
                  labor_lines: [],
                  part_lines: [],
                  labor_total: 50,
                  parts_total: 0,
                  total: 50,
                }),
              },
              {
                _id: 'service-2',
                is_active: false,
                toObject: () => ({
                  _id: 'service-2',
                  name: 'Brake Estimate',
                  labor_lines: [],
                  part_lines: [],
                  labor_total: 180,
                  parts_total: 0,
                  total: 180,
                }),
              },
            ]),
          }),
        }),
      } as never,
      {
        aggregate,
      } as never,
    );

    const result = await service.findAll();

    expect(aggregate).toHaveBeenCalledTimes(1);
    expect(result).toEqual([
      expect.objectContaining({
        id: 'service-1',
        is_active: true,
        usage_count: 2,
      }),
      expect.objectContaining({
        id: 'service-2',
        is_active: false,
        usage_count: 0,
      }),
    ]);
    expect(result[0]).not.toHaveProperty('normalized_name');
  });

  it('blocks service deletion when estimate lines already reference the service', async () => {
    const session = createSessionMock();
    const service = new ServiceCatalogService(
      {
        db: {
          startSession: jest.fn().mockResolvedValue(session),
        },
        findById: jest.fn().mockReturnValue(
          createSessionExecMock({
            _id: '507f1f77bcf86cd799439013',
            is_active: true,
          }),
        ),
      } as never,
      {
        countDocuments: jest.fn().mockReturnValue(createSessionExecMock(2)),
      } as never,
    );

    await expect(
      service.remove('507f1f77bcf86cd799439013'),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(session.endSession).toHaveBeenCalled();
  });

  it('deactivates a service without deleting its history', async () => {
    const save = jest.fn().mockResolvedValue(undefined);
    const service = new ServiceCatalogService(
      {
        findById: jest.fn().mockReturnValue({
          exec: jest.fn().mockResolvedValue({
            _id: '507f1f77bcf86cd799439013',
            name: 'Oil Change',
            is_active: true,
            labor_lines: [],
            part_lines: [],
            labor_total: 50,
            parts_total: 0,
            total: 50,
            toObject: () => ({
              _id: '507f1f77bcf86cd799439013',
              name: 'Oil Change',
              is_active: false,
              labor_lines: [],
              part_lines: [],
              labor_total: 50,
              parts_total: 0,
              total: 50,
            }),
            save,
          }),
        }),
      } as never,
      {
        countDocuments: jest.fn().mockReturnValue({
          exec: jest.fn().mockResolvedValue(2),
        }),
      } as never,
    );

    const result = await service.deactivate('507f1f77bcf86cd799439013');

    expect(save).toHaveBeenCalled();
    expect(result).toMatchObject({
      is_active: false,
      usage_count: 2,
    });
  });

  it('deletes an unused service', async () => {
    const session = createSessionMock();
    const deleteOne = jest.fn().mockReturnValue({
      exec: jest.fn().mockResolvedValue({ deletedCount: 1 }),
    });
    const updateOne = jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue(undefined) });
    const service = new ServiceCatalogService(
      {
        db: {
          startSession: jest.fn().mockResolvedValue(session),
        },
        findById: jest.fn().mockReturnValue(
          createSessionExecMock({
            _id: '507f1f77bcf86cd799439013',
            is_active: true,
          }),
        ),
        updateOne,
        deleteOne,
      } as never,
      {
        countDocuments: jest.fn().mockReturnValue(createSessionExecMock(0)),
      } as never,
    );

    await expect(service.remove('507f1f77bcf86cd799439013')).resolves.toEqual({
      deleted: true,
    });
    expect(deleteOne).toHaveBeenCalledWith(
      { _id: '507f1f77bcf86cd799439013' },
      { session },
    );
    expect(session.endSession).toHaveBeenCalled();
  });

  it('rejects empty canned services without labor or part rows', async () => {
    const service = new ServiceCatalogService(
      {
        find: jest.fn().mockReturnValue({
          sort: jest.fn().mockReturnValue({
            exec: jest.fn().mockResolvedValue([]),
          }),
        }),
        create: jest.fn(),
      } as never,
      {} as never,
    );

    await expect(
      service.create({
        name: 'Empty Service',
        labor_lines: [],
        part_lines: [],
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('warns before creating an identical canned service', async () => {
    const service = new ServiceCatalogService(
      {
        find: jest.fn().mockReturnValue({
          sort: jest.fn().mockReturnValue({
            exec: jest.fn().mockResolvedValue([
              {
                _id: '507f1f77bcf86cd799439013',
                name: 'Oil Change',
                is_active: true,
                labor_lines: [
                  {
                    description: 'Oil labor',
                    hours: 1,
                    rate: 100,
                    discount_percent: 0,
                  },
                ],
                part_lines: [],
              },
            ]),
          }),
        }),
      } as never,
      {} as never,
    );

    await expect(
      service.create({
        name: '  Oil   Change ',
        labor_lines: [
          {
            description: 'Oil labor',
            hours: 1,
            rate: 100,
            discount_percent: 0,
          },
        ],
        part_lines: [],
      }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('allows the same canned service name when the labor or part lines differ', async () => {
    const create = jest.fn().mockResolvedValue({
      _id: 'service-2',
      name: 'Oil Change',
      normalized_name: 'oil change',
      is_active: true,
      labor_lines: [],
      part_lines: [],
      labor_total: 100,
      parts_total: 0,
      total: 100,
      toObject: () => ({
        _id: 'service-2',
        name: 'Oil Change',
        normalized_name: 'oil change',
        is_active: true,
        labor_lines: [],
        part_lines: [],
        labor_total: 100,
        parts_total: 0,
        total: 100,
      }),
    });

    const service = new ServiceCatalogService(
      {
        find: jest.fn().mockReturnValue({
          sort: jest.fn().mockReturnValue({
            exec: jest.fn().mockResolvedValue([
              {
                _id: 'service-1',
                name: 'Oil Change',
                is_active: true,
                labor_lines: [
                  {
                    description: 'Oil labor',
                    hours: 1,
                    rate: 90,
                    discount_percent: 0,
                  },
                ],
                part_lines: [],
              },
            ]),
          }),
        }),
        create,
      } as never,
      {
        countDocuments: jest.fn().mockReturnValue({
          exec: jest.fn().mockResolvedValue(0),
        }),
      } as never,
    );

    await expect(
      service.create({
        name: 'Oil Change',
        labor_lines: [
          {
            description: 'Oil labor',
            hours: 1,
            rate: 100,
            discount_percent: 0,
          },
        ],
        part_lines: [],
      }),
    ).resolves.toMatchObject({
      id: 'service-2',
      name: 'Oil Change',
    });
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'Oil Change',
        normalized_name: 'oil change',
      }),
    );
  });

  it('treats labor line order as identical when comparing duplicates', async () => {
    const service = new ServiceCatalogService(
      {
        find: jest.fn().mockReturnValue({
          sort: jest.fn().mockReturnValue({
            exec: jest.fn().mockResolvedValue([
              {
                _id: '507f1f77bcf86cd799439013',
                name: 'Brake Service',
                is_active: true,
                labor_lines: [
                  {
                    description: 'Install pads',
                    hours: 1,
                    rate: 120,
                    discount_percent: 0,
                  },
                  {
                    description: 'Road test',
                    hours: 0.25,
                    rate: 120,
                    discount_percent: 0,
                  },
                ],
                part_lines: [],
              },
            ]),
          }),
        }),
      } as never,
      {} as never,
    );

    await expect(
      service.create({
        name: 'Brake Service',
        labor_lines: [
          {
            description: 'Road test',
            hours: 0.25,
            rate: 120,
            discount_percent: 0,
          },
          {
            description: 'Install pads',
            hours: 1,
            rate: 120,
            discount_percent: 0,
          },
        ],
        part_lines: [],
      }),
    ).rejects.toBeInstanceOf(ConflictException);
  });
});
