import { ContractTemplatesService } from './contract-templates.service';

const ORG_ID = '507f1f77bcf86cd7994390aa';
const TPL_A = '507f1f77bcf86cd7994390c1';
const TPL_B = '507f1f77bcf86cd7994390c2';

describe('ContractTemplatesService', () => {
  it('setDefault unsets other defaults in a transaction', async () => {
    const target = {
      _id: TPL_A,
      name: 'Standard',
      body: 'Terms',
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

    const service = new ContractTemplatesService(
      { findOne, updateMany, create: jest.fn() } as never,
      { startSession } as never,
    );

    const result = await service.setDefault(TPL_A, ORG_ID);

    expect(updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        is_default: true,
        _id: { $ne: expect.anything() },
      }),
      { $set: { is_default: false } },
      expect.objectContaining({ session: expect.anything() }),
    );
    expect(result.is_default).toBe(true);
    expect(endSession).toHaveBeenCalled();
  });

  it('deactivate sets is_active false', async () => {
    const updated = {
      _id: TPL_B,
      name: 'Old',
      body: 'body',
      is_default: false,
      is_active: false,
      created_at: new Date(),
      updated_at: new Date(),
    };
    const findOneAndUpdate = jest.fn().mockReturnValue({
      exec: jest.fn().mockResolvedValue(updated),
    });

    const service = new ContractTemplatesService(
      {
        findOneAndUpdate,
        findOne: jest.fn(),
        create: jest.fn(),
        updateMany: jest.fn(),
      } as never,
      { startSession: jest.fn() } as never,
    );

    const result = await service.deactivate(TPL_B, ORG_ID);
    expect(result.is_active).toBe(false);
    expect(findOneAndUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ _id: expect.anything() }),
      { $set: { is_active: false, is_default: false } },
      expect.any(Object),
    );
  });
});
