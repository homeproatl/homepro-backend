import { ConflictException } from '@nestjs/common';
import { CustomersService } from './customers.service';

describe('CustomersService', () => {
  it('builds a tokenized search query for customer list filtering', async () => {
    const exec = jest.fn().mockResolvedValue([]);
    const sort = jest.fn().mockReturnValue({ exec });
    const find = jest.fn().mockReturnValue({ sort });
    const service = new CustomersService(
      {
        find,
      } as never,
      {} as never,
      {} as never,
      {} as never,
    );

    await service.findAll({ search: 'john doe' });

    expect(find).toHaveBeenCalledWith({
      $and: [
        {
          $or: [
            { first_name: /john/i },
            { last_name: /john/i },
            { phone: /john/i },
            { email: /john/i },
          ],
        },
        {
          $or: [
            { first_name: /doe/i },
            { last_name: /doe/i },
            { phone: /doe/i },
            { email: /doe/i },
          ],
        },
      ],
    });
  });

  it('blocks customer deletion while vehicles or jobs still reference the customer', async () => {
    const customer = {
      _id: '507f1f77bcf86cd799439011',
      toObject: () => ({ _id: '507f1f77bcf86cd799439011' }),
    };
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
      {
        create: jest.fn().mockResolvedValue(undefined),
      } as never,
    );

    await expect(
      service.remove('507f1f77bcf86cd799439011'),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('deletes a customer when no vehicles or jobs reference it', async () => {
    const deleteOne = jest.fn().mockReturnValue({
      exec: jest.fn().mockResolvedValue({ deletedCount: 1 }),
    });
    const service = new CustomersService(
      {
        findById: jest.fn().mockReturnValue({
          exec: jest.fn().mockResolvedValue({
            _id: '507f1f77bcf86cd799439011',
            toObject: () => ({ _id: '507f1f77bcf86cd799439011' }),
          }),
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
      {
        create: jest.fn().mockResolvedValue(undefined),
      } as never,
    );

    await expect(service.remove('507f1f77bcf86cd799439011')).resolves.toEqual({
      deleted: true,
    });
    expect(deleteOne).toHaveBeenCalledWith({ _id: '507f1f77bcf86cd799439011' });
  });

  it('archives a customer instead of deleting historical records', async () => {
    const save = jest.fn().mockResolvedValue(undefined);
    const customer = {
      _id: '507f1f77bcf86cd799439011',
      is_archived: false,
      toObject: () => ({ _id: '507f1f77bcf86cd799439011', is_archived: false }),
      save,
    };
    const service = new CustomersService(
      {
        findById: jest.fn().mockReturnValue({
          exec: jest.fn().mockResolvedValue(customer),
        }),
      } as never,
      {} as never,
      {} as never,
      {
        create: jest.fn().mockResolvedValue(undefined),
      } as never,
    );

    await expect(
      service.archive('507f1f77bcf86cd799439011'),
    ).resolves.toMatchObject({
      _id: '507f1f77bcf86cd799439011',
      is_archived: true,
    });
    expect(save).toHaveBeenCalled();
  });
});
