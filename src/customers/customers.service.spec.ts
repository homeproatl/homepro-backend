import { ConflictException } from '@nestjs/common';
import { CustomersService } from './customers.service';

describe('CustomersService', () => {
  it('serializes customer responses with id instead of Mongo internals', async () => {
    const createdAt = new Date('2026-04-03T08:00:00.000Z');
    const updatedAt = new Date('2026-04-03T09:00:00.000Z');
    const service = new CustomersService(
      {
        create: jest.fn().mockResolvedValue({
          _id: '507f1f77bcf86cd799439099',
          first_name: 'Rico',
          last_name: 'Owner',
          phone: '123',
          email: 'rico@example.com',
          is_archived: false,
          created_at: createdAt,
          updated_at: updatedAt,
        }),
      } as never,
      {} as never,
      {} as never,
      {} as never,
    );

    await expect(
      service.create({
        first_name: 'Rico',
        last_name: 'Owner',
        phone: '123',
        email: 'rico@example.com',
      }),
    ).resolves.toEqual({
      id: '507f1f77bcf86cd799439099',
      first_name: 'Rico',
      last_name: 'Owner',
      phone: '123',
      email: 'rico@example.com',
      is_archived: false,
      created_at: createdAt.toISOString(),
      updated_at: updatedAt.toISOString(),
    });
  });

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

  it('bounds tokenized customer search clauses to avoid excessive regex fan-out', async () => {
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

    await service.findAll({
      search: "one two three four five six seven eight",
    });

    expect(find).toHaveBeenCalledWith({
      $and: [
        expect.any(Object),
        expect.any(Object),
        expect.any(Object),
        expect.any(Object),
        expect.any(Object),
        expect.any(Object),
      ],
    });
  });

  it('applies archive-state filtering to customer lists', async () => {
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

    await service.findAll({ is_archived: true });

    expect(find).toHaveBeenCalledWith({
      is_archived: true,
    });
  });

  it('blocks customer deletion while vehicles or estimates still reference the customer', async () => {
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

  it('deletes a customer when no vehicles or estimates reference it', async () => {
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
      id: '507f1f77bcf86cd799439011',
      is_archived: true,
    });
    expect(save).toHaveBeenCalled();
  });
});
