import { ConflictException } from '@nestjs/common';
import { VehiclesService } from './vehicles.service';

describe('VehiclesService', () => {
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
});
