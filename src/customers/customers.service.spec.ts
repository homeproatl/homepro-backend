import { ConflictException } from '@nestjs/common';
import { CustomersService } from './customers.service';

describe('CustomersService', () => {
  it('blocks customer deletion while vehicles or jobs still reference the customer', async () => {
    const customer = { _id: '507f1f77bcf86cd799439011' };
    const service = new CustomersService(
      {
        findById: jest.fn().mockReturnValue({
          exec: jest.fn().mockResolvedValue(customer),
        }),
      } as never,
      {
        countDocuments: jest.fn().mockReturnValue({
          exec: jest.fn().mockResolvedValue(2),
        }),
      } as never,
      {
        countDocuments: jest.fn().mockReturnValue({
          exec: jest.fn().mockResolvedValue(1),
        }),
      } as never,
    );

    await expect(service.remove('507f1f77bcf86cd799439011')).rejects.toBeInstanceOf(
      ConflictException,
    );
  });

  it('deletes a customer when no vehicles or jobs reference it', async () => {
    const deleteOne = jest.fn().mockReturnValue({
      exec: jest.fn().mockResolvedValue({ deletedCount: 1 }),
    });
    const service = new CustomersService(
      {
        findById: jest.fn().mockReturnValue({
          exec: jest.fn().mockResolvedValue({ _id: '507f1f77bcf86cd799439011' }),
        }),
        deleteOne,
      } as never,
      {
        countDocuments: jest.fn().mockReturnValue({
          exec: jest.fn().mockResolvedValue(0),
        }),
      } as never,
      {
        countDocuments: jest.fn().mockReturnValue({
          exec: jest.fn().mockResolvedValue(0),
        }),
      } as never,
    );

    await expect(service.remove('507f1f77bcf86cd799439011')).resolves.toEqual({
      deleted: true,
    });
    expect(deleteOne).toHaveBeenCalledWith({ _id: '507f1f77bcf86cd799439011' });
  });
});
