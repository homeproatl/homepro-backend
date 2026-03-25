import { ConflictException } from '@nestjs/common';
import { VehiclesService } from './vehicles.service';

describe('VehiclesService', () => {
  it('blocks vehicle deletion while jobs still reference the vehicle', async () => {
    const service = new VehiclesService(
      {
        findById: jest.fn().mockReturnValue({
          exec: jest.fn().mockResolvedValue({ _id: '507f1f77bcf86cd799439012' }),
        }),
      } as never,
      {} as never,
      {
        countDocuments: jest.fn().mockReturnValue({
          exec: jest.fn().mockResolvedValue(3),
        }),
      } as never,
    );

    await expect(service.remove('507f1f77bcf86cd799439012')).rejects.toBeInstanceOf(
      ConflictException,
    );
  });

  it('deletes a vehicle when no jobs reference it', async () => {
    const deleteOne = jest.fn().mockReturnValue({
      exec: jest.fn().mockResolvedValue({ deletedCount: 1 }),
    });
    const service = new VehiclesService(
      {
        findById: jest.fn().mockReturnValue({
          exec: jest.fn().mockResolvedValue({ _id: '507f1f77bcf86cd799439012' }),
        }),
        deleteOne,
      } as never,
      {} as never,
      {
        countDocuments: jest.fn().mockReturnValue({
          exec: jest.fn().mockResolvedValue(0),
        }),
      } as never,
    );

    await expect(service.remove('507f1f77bcf86cd799439012')).resolves.toEqual({
      deleted: true,
    });
    expect(deleteOne).toHaveBeenCalledWith({ _id: '507f1f77bcf86cd799439012' });
  });
});
