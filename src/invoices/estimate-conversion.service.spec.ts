import { EstimateConversionService } from './estimate-conversion.service';

describe('EstimateConversionService', () => {
  const actor = {
    user_id: '507f1f77bcf86cd7994390ac',
    organization_id: '507f1f77bcf86cd7994390aa',
    role: 'ADMIN',
    email: 'a@b.co',
    name: 'Admin',
  } as const;

  it('returns existing invoice without allocating another number', async () => {
    const existing = {
      _id: 'inv1',
      number: 'INV-000001',
      type: 'invoice',
    };
    const findOne = jest.fn().mockReturnValue({
      exec: jest.fn().mockResolvedValue(existing),
    });
    const updateOne = jest.fn().mockReturnValue({
      exec: jest.fn().mockResolvedValue({ modifiedCount: 0 }),
    });
    const serialize = jest
      .fn()
      .mockReturnValue({ id: 'inv1', number: 'INV-000001' });
    const allocateNextNumber = jest.fn();

    const service = new EstimateConversionService(
      {
        findOne,
        updateOne,
        findById: jest.fn().mockReturnValue({
          exec: jest.fn().mockResolvedValue(existing),
        }),
      } as never,
      { create: jest.fn() } as never,
      { allocateNextNumber } as never,
      { serialize } as never,
      { cloneDocumentAssets: jest.fn() } as never,
      { getSnapshotSource: jest.fn() } as never,
      { startSession: jest.fn() } as never,
    );

    const result = await service.convertToInvoice(
      '507f1f77bcf86cd799439011',
      undefined,
      actor as never,
    );

    expect(allocateNextNumber).not.toHaveBeenCalled();
    expect(serialize).toHaveBeenCalledWith(existing);
    expect(result).toEqual({ id: 'inv1', number: 'INV-000001' });
  });

  it('rejects conversion when estimate is neither pending nor approved', async () => {
    const findOne = jest
      .fn()
      .mockReturnValueOnce({
        exec: jest.fn().mockResolvedValue(null),
      })
      .mockReturnValueOnce({
        exec: jest.fn().mockResolvedValue({
          _id: 'est1',
          type: 'estimate',
          status: 'draft',
        }),
      });

    const service = new EstimateConversionService(
      { findOne } as never,
      { create: jest.fn() } as never,
      { allocateNextNumber: jest.fn() } as never,
      { serialize: jest.fn() } as never,
      { cloneDocumentAssets: jest.fn() } as never,
      { getSnapshotSource: jest.fn() } as never,
      { startSession: jest.fn() } as never,
    );

    await expect(
      service.convertToInvoice(
        '507f1f77bcf86cd799439011',
        undefined,
        actor as never,
      ),
    ).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'ESTIMATE_NOT_CONVERTIBLE' }),
    });
  });
});
