import { ConflictException } from '@nestjs/common';
import { VehiclesService } from './vehicles.service';

describe('VehiclesService', () => {
  it('repairs legacy unique VIN and license-plate indexes to allow nullable identifiers', async () => {
    const indexes = jest.fn().mockResolvedValue([
      { name: '_id_' },
      { name: 'vin_1', unique: true, key: { vin: 1 } },
      {
        name: 'license_plate_1',
        unique: true,
        key: { license_plate: 1 },
      },
    ]);
    const dropIndex = jest.fn().mockResolvedValue(undefined);
    const updateMany = jest.fn().mockResolvedValue({ modifiedCount: 1 });
    const createIndex = jest.fn().mockResolvedValue('ok');

    const service = new VehiclesService(
      {
        collection: {
          indexes,
          dropIndex,
          updateMany,
          createIndex,
        },
      } as never,
      {} as never,
      {} as never,
      {} as never,
    );

    await service.onModuleInit();

    expect(dropIndex).toHaveBeenCalledTimes(2);
    expect(dropIndex).toHaveBeenCalledWith('vin_1');
    expect(dropIndex).toHaveBeenCalledWith('license_plate_1');
    expect(updateMany).toHaveBeenCalledTimes(1);
    expect(createIndex).toHaveBeenNthCalledWith(
      1,
      { vin: 1 },
      {
        name: 'vin_1',
        unique: true,
        partialFilterExpression: {
          vin: { $type: 'string' },
        },
      },
    );
    expect(createIndex).toHaveBeenNthCalledWith(
      2,
      { license_plate: 1 },
      {
        name: 'license_plate_1',
        unique: true,
        partialFilterExpression: {
          license_plate: { $type: 'string' },
        },
      },
    );
  });

  it('tolerates concurrent vehicle index repair during startup', async () => {
    const indexes = jest
      .fn()
      .mockResolvedValueOnce([
        { name: '_id_' },
        { name: 'vin_1', unique: true, key: { vin: 1 } },
        {
          name: 'license_plate_1',
          unique: true,
          partialFilterExpression: {
            license_plate: { $type: 'string' },
          },
        },
      ])
      .mockResolvedValueOnce([
        { name: '_id_' },
        {
          name: 'vin_1',
          unique: true,
          partialFilterExpression: {
            vin: { $type: 'string' },
          },
        },
        {
          name: 'license_plate_1',
          unique: true,
          partialFilterExpression: {
            license_plate: { $type: 'string' },
          },
        },
      ]);
    const dropIndex = jest
      .fn()
      .mockRejectedValue({ codeName: 'IndexNotFound' });
    const updateMany = jest.fn().mockResolvedValue({ modifiedCount: 0 });
    const createIndex = jest
      .fn()
      .mockRejectedValue({ codeName: 'IndexOptionsConflict' });

    const service = new VehiclesService(
      {
        collection: {
          indexes,
          dropIndex,
          updateMany,
          createIndex,
        },
      } as never,
      {} as never,
      {} as never,
      {} as never,
    );

    await expect(service.onModuleInit()).resolves.toBeUndefined();

    expect(dropIndex).toHaveBeenCalledWith('vin_1');
    expect(updateMany).toHaveBeenCalledTimes(1);
    expect(createIndex).toHaveBeenCalledWith(
      { vin: 1 },
      {
        name: 'vin_1',
        unique: true,
        partialFilterExpression: {
          vin: { $type: 'string' },
        },
      },
    );
  });

  it('serializes vehicle responses with id instead of Mongo internals', async () => {
    const createdAt = new Date('2026-04-03T08:00:00.000Z');
    const updatedAt = new Date('2026-04-03T09:00:00.000Z');
    const service = new VehiclesService(
      {
        findById: jest.fn().mockReturnValue({
          exec: jest.fn().mockResolvedValue({
            _id: '507f1f77bcf86cd799439012',
            customer_id: '507f1f77bcf86cd799439010',
            is_archived: false,
            color: 'Black',
            year: 2020,
            make: 'Honda',
            model: 'Accord',
            sub_model: null,
            mileage: 40000,
            mileage_out: 40250,
            vin: 'VIN123',
            license_plate: 'ABC123',
            is_incomplete: false,
            created_at: createdAt,
            updated_at: updatedAt,
          }),
        }),
      } as never,
      {} as never,
      {} as never,
      {} as never,
    );

    await expect(service.findById('507f1f77bcf86cd799439012')).resolves.toEqual({
      id: '507f1f77bcf86cd799439012',
      customer_id: '507f1f77bcf86cd799439010',
      is_archived: false,
      color: 'Black',
      year: 2020,
      make: 'Honda',
      model: 'Accord',
      sub_model: null,
      mileage: 40000,
      mileage_out: 40250,
      vin: 'VIN123',
      license_plate: 'ABC123',
      is_incomplete: false,
      created_at: createdAt.toISOString(),
      updated_at: updatedAt.toISOString(),
    });
  });

  it('serializes incomplete vehicle responses with nullable identifiers', async () => {
    const service = new VehiclesService(
      {
        findById: jest.fn().mockReturnValue({
          exec: jest.fn().mockResolvedValue({
            _id: '507f1f77bcf86cd799439012',
            customer_id: '507f1f77bcf86cd799439010',
            is_archived: false,
            color: null,
            year: 2020,
            make: 'Honda',
            model: 'Accord',
            sub_model: null,
            mileage: 40000,
            vin: null,
            license_plate: null,
            is_incomplete: false,
          }),
        }),
      } as never,
      {} as never,
      {} as never,
      {} as never,
    );

    await expect(service.findById('507f1f77bcf86cd799439012')).resolves.toMatchObject({
      id: '507f1f77bcf86cd799439012',
      vin: null,
      license_plate: null,
      is_incomplete: true,
    });
  });

  it('applies archive-state filtering to vehicle list pipelines', async () => {
    const aggregate = jest.fn().mockReturnValue({
      exec: jest.fn().mockResolvedValue([]),
    });
    const service = new VehiclesService(
      {
        aggregate,
      } as never,
      {} as never,
      {} as never,
      {} as never,
    );

    await service.findAll({ is_archived: true });

    expect(aggregate).toHaveBeenCalledWith(
      expect.arrayContaining([
        {
          $match: {
            is_archived: true,
          },
        },
      ]),
    );
  });

  it('blocks vehicle deletion while estimates still reference the vehicle', async () => {
    const service = new VehiclesService(
      {
        findById: jest.fn().mockReturnValue({
          exec: jest.fn().mockResolvedValue({
            _id: '507f1f77bcf86cd799439012',
            toObject: () => ({ _id: '507f1f77bcf86cd799439012' }),
          }),
        }),
      } as never,
      {} as never,
      {
        countDocuments: jest.fn().mockReturnValue({
          exec: jest.fn().mockResolvedValue(3),
        }),
      } as never,
      {
        create: jest.fn().mockResolvedValue(undefined),
      } as never,
    );

    await expect(service.remove('507f1f77bcf86cd799439012')).rejects.toBeInstanceOf(
      ConflictException,
    );
  });

  it('deletes a vehicle when no estimates reference it', async () => {
    const deleteOne = jest.fn().mockReturnValue({
      exec: jest.fn().mockResolvedValue({ deletedCount: 1 }),
    });
    const service = new VehiclesService(
      {
        findById: jest.fn().mockReturnValue({
          exec: jest.fn().mockResolvedValue({
            _id: '507f1f77bcf86cd799439012',
            toObject: () => ({ _id: '507f1f77bcf86cd799439012' }),
          }),
        }),
        deleteOne,
      } as never,
      {} as never,
      {
        countDocuments: jest.fn().mockReturnValue({
          exec: jest.fn().mockResolvedValue(0),
        }),
      } as never,
      {
        create: jest.fn().mockResolvedValue(undefined),
      } as never,
    );

    await expect(service.remove('507f1f77bcf86cd799439012')).resolves.toEqual({
      deleted: true,
    });
    expect(deleteOne).toHaveBeenCalledWith({ _id: '507f1f77bcf86cd799439012' });
  });

  it('blocks reassigning a vehicle to an archived customer', async () => {
    const vehicle = {
      _id: '507f1f77bcf86cd799439012',
      customer_id: '507f1f77bcf86cd799439010',
      save: jest.fn(),
    };
    const service = new VehiclesService(
      {
        findById: jest.fn().mockReturnValue({
          exec: jest.fn().mockResolvedValue(vehicle),
        }),
      } as never,
      {
        findById: jest.fn().mockReturnValue({
          exec: jest.fn().mockResolvedValue({
            _id: '507f1f77bcf86cd799439013',
            is_archived: true,
          }),
        }),
      } as never,
      {} as never,
      {} as never,
    );

    await expect(
      service.update('507f1f77bcf86cd799439012', {
        customer_id: '507f1f77bcf86cd799439013',
      }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('allows clearing VIN and license plate during vehicle updates', async () => {
    const save = jest.fn().mockResolvedValue(undefined);
    const vehicle = {
      _id: '507f1f77bcf86cd799439012',
      customer_id: '507f1f77bcf86cd799439010',
      is_archived: false,
      color: 'Blue',
      year: 2020,
      make: 'Honda',
      model: 'Civic',
      sub_model: 'EX',
      mileage: 183368,
      mileage_out: 183500,
      vin: 'VIN123456',
      license_plate: 'ABC123',
      is_incomplete: false,
      created_at: new Date('2026-04-03T08:00:00.000Z'),
      updated_at: new Date('2026-04-03T09:00:00.000Z'),
      set: jest.fn((key: string, value: unknown) => {
        (vehicle as Record<string, unknown>)[key] = value;
      }),
      save,
    };

    const service = new VehiclesService(
      {
        findById: jest.fn().mockReturnValue({
          exec: jest.fn().mockResolvedValue(vehicle),
        }),
      } as never,
      {} as never,
      {} as never,
      {} as never,
    );

    const result = await service.update('507f1f77bcf86cd799439012', {
      make: 'Honda',
      model: 'Civic',
      vin: null,
      license_plate: null,
    });

    expect(save).toHaveBeenCalledTimes(1);
    expect(vehicle.vin).toBeNull();
    expect(vehicle.license_plate).toBeNull();
    expect(vehicle.is_incomplete).toBe(true);
    expect(result).toMatchObject({
      id: '507f1f77bcf86cd799439012',
      vin: null,
      license_plate: null,
      is_incomplete: true,
    });
  });
});
