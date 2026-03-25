import { ConflictException } from '@nestjs/common';
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
  it('upserts minimal catalog entries idempotently', async () => {
    const exec = jest.fn<Promise<void>, []>().mockResolvedValue(undefined);
    const updateOne = jest.fn().mockReturnValue({ exec });
    const service = new ServiceCatalogService(
      { updateOne } as never,
      {} as never,
    );

    await service.ensureMinimalCatalog();

    expect(updateOne).toHaveBeenCalledTimes(3);
    const [filter, update, options] = updateOne.mock.calls[0] as [
      { name: string },
      { $setOnInsert: { name: string } },
      { upsert: boolean },
    ];
    expect(filter).toEqual({ name: 'Oil Change' });
    expect(update.$setOnInsert).toEqual(
      expect.objectContaining({ name: 'Oil Change' }),
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
                  base_price: 50,
                  estimated_duration_minutes: 45,
                }),
              },
              {
                _id: 'service-2',
                is_active: false,
                toObject: () => ({
                  _id: 'service-2',
                  name: 'Brake Job',
                  base_price: 180,
                  estimated_duration_minutes: 120,
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
        _id: 'service-1',
        is_active: true,
        usage_count: 2,
      }),
      expect.objectContaining({
        _id: 'service-2',
        is_active: false,
        usage_count: 0,
      }),
    ]);
  });

  it('blocks service deletion when job lines already reference the service', async () => {
    const session = createSessionMock();
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
      } as never,
      {
        countDocuments: jest.fn().mockReturnValue(createSessionExecMock(2)),
      } as never,
    );

    await expect(
      service.remove('507f1f77bcf86cd799439013'),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(updateOne).toHaveBeenCalledWith(
      { _id: '507f1f77bcf86cd799439013' },
      { $set: { is_active: false }, $inc: { __v: 1 } },
      expect.objectContaining({ session }),
    );
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
            base_price: 50,
            estimated_duration_minutes: 45,
            toObject: () => ({
              _id: '507f1f77bcf86cd799439013',
              name: 'Oil Change',
              is_active: false,
              base_price: 50,
              estimated_duration_minutes: 45,
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
});
