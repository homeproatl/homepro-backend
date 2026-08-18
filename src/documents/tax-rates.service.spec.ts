import { TaxRatesService } from './tax-rates.service';

const ORG_ID = '507f1f77bcf86cd7994390aa';
const RATE_A = '507f1f77bcf86cd7994390b1';
const RATE_B = '507f1f77bcf86cd7994390b2';

describe('TaxRatesService', () => {
  it('setDefault unsets other defaults in a transaction', async () => {
    const target = {
      _id: RATE_A,
      name: 'Rate A',
      rate_basis_points: 800,
      is_default: false,
      is_active: true,
      save: jest.fn().mockResolvedValue(undefined),
      created_at: new Date(),
      updated_at: new Date(),
    };

    const findOne = jest.fn().mockReturnValue({
      session: jest.fn().mockReturnValue({
        exec: jest.fn().mockResolvedValue(target),
      }),
    });
    const updateMany = jest.fn().mockReturnValue({
      exec: jest.fn().mockResolvedValue({ modifiedCount: 1 }),
    });
    const withTransaction = jest.fn(async (fn: () => Promise<void>) => fn());
    const endSession = jest.fn();
    const startSession = jest.fn().mockResolvedValue({
      withTransaction,
      endSession,
    });

    const service = new TaxRatesService(
      { findOne, updateMany, create: jest.fn() } as never,
      { startSession } as never,
    );

    const result = await service.setDefault(RATE_A, ORG_ID);

    expect(updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        is_default: true,
        _id: { $ne: expect.anything() },
      }),
      { $set: { is_default: false } },
      expect.objectContaining({ session: expect.anything() }),
    );
    expect(target.is_default).toBe(true);
    expect(target.save).toHaveBeenCalled();
    expect(result.is_default).toBe(true);
    expect(endSession).toHaveBeenCalled();
  });

  it('deactivate sets is_active false', async () => {
    const updated = {
      _id: RATE_B,
      name: 'Old',
      rate_basis_points: 100,
      is_default: false,
      is_active: false,
      created_at: new Date(),
      updated_at: new Date(),
    };
    const findOneAndUpdate = jest.fn().mockReturnValue({
      exec: jest.fn().mockResolvedValue(updated),
    });

    const service = new TaxRatesService(
      {
        findOneAndUpdate,
        findOne: jest.fn(),
        create: jest.fn(),
        updateMany: jest.fn(),
      } as never,
      { startSession: jest.fn() } as never,
    );

    const result = await service.deactivate(RATE_B, ORG_ID);
    expect(result.is_active).toBe(false);
    expect(findOneAndUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ _id: expect.anything() }),
      { $set: { is_active: false, is_default: false } },
      expect.any(Object),
    );
  });

  it('deactivate clears is_default when deactivating the default rate', async () => {
    const updated = {
      _id: RATE_A,
      name: 'Default Rate',
      rate_basis_points: 800,
      is_default: false,
      is_active: false,
      created_at: new Date(),
      updated_at: new Date(),
    };
    const findOneAndUpdate = jest.fn().mockReturnValue({
      exec: jest.fn().mockResolvedValue(updated),
    });

    const service = new TaxRatesService(
      {
        findOneAndUpdate,
        findOne: jest.fn(),
        create: jest.fn(),
        updateMany: jest.fn(),
      } as never,
      { startSession: jest.fn() } as never,
    );

    const result = await service.deactivate(RATE_A, ORG_ID);
    expect(result.is_default).toBe(false);
    expect(result.is_active).toBe(false);
    expect(findOneAndUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ _id: expect.anything() }),
      { $set: { is_active: false, is_default: false } },
      expect.any(Object),
    );
  });

  it('create persists a new active non-default rate', async () => {
    const created = {
      _id: RATE_A,
      name: 'NYC',
      rate_basis_points: 888,
      is_default: false,
      is_active: true,
      created_at: new Date(),
      updated_at: new Date(),
    };
    const create = jest.fn().mockResolvedValue(created);
    const service = new TaxRatesService(
      { create, findOne: jest.fn(), findOneAndUpdate: jest.fn() } as never,
      { startSession: jest.fn() } as never,
    );

    const result = await service.create(
      { name: 'NYC', rate_basis_points: 888 },
      ORG_ID,
    );
    expect(create).toHaveBeenCalled();
    expect(result.name).toBe('NYC');
    expect(result.is_default).toBe(false);
  });
});
