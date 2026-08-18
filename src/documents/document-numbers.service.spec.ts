import { DocumentNumbersService } from './document-numbers.service';

describe('DocumentNumbersService', () => {
  const organizationId = '507f1f77bcf86cd7994390aa';

  function createService(findOneAndUpdateImpl: jest.Mock) {
    return new DocumentNumbersService({
      findOneAndUpdate: findOneAndUpdateImpl,
    } as never);
  }

  it('allocates EST-000001 on first upsert (counter starts at 0 → 1)', async () => {
    const exec = jest.fn().mockResolvedValue({ next_value: 1, prefix: null });
    const session = jest.fn().mockReturnValue({ exec });
    const findOneAndUpdate = jest.fn().mockReturnValue({ session, exec });

    const service = createService(findOneAndUpdate);
    const number = await service.allocateNextNumber(organizationId, 'estimate');

    expect(number).toBe('EST-000001');
    expect(findOneAndUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        document_type: 'estimate',
      }),
      expect.objectContaining({
        $inc: { next_value: 1 },
      }),
      expect.objectContaining({
        upsert: true,
        returnDocument: 'after',
      }),
    );
  });

  it('allocates INV padded numbers from counter', async () => {
    const exec = jest.fn().mockResolvedValue({ next_value: 42, prefix: null });
    const findOneAndUpdate = jest.fn().mockReturnValue({ exec });
    const service = createService(findOneAndUpdate);

    await expect(
      service.allocateNextNumber(organizationId, 'invoice'),
    ).resolves.toBe('INV-000042');
  });

  it('uses configured prefix for future allocations only', async () => {
    const exec = jest
      .fn()
      .mockResolvedValue({ next_value: 3, prefix: 'QUOTE' });
    const findOneAndUpdate = jest.fn().mockReturnValue({ exec });
    const service = createService(findOneAndUpdate);

    await expect(
      service.allocateNextNumber(organizationId, 'estimate'),
    ).resolves.toBe('QUOTE-000003');
  });

  it('supports concurrent-style sequential allocates without collision', async () => {
    let counter = 0;
    const findOneAndUpdate = jest.fn().mockImplementation(() => ({
      exec: jest.fn().mockImplementation(() => {
        counter += 1;
        return Promise.resolve({ next_value: counter, prefix: null });
      }),
    }));

    const service = createService(findOneAndUpdate);
    const results = await Promise.all([
      service.allocateNextNumber(organizationId, 'estimate'),
      service.allocateNextNumber(organizationId, 'estimate'),
      service.allocateNextNumber(organizationId, 'estimate'),
    ]);

    expect(results.sort()).toEqual(['EST-000001', 'EST-000002', 'EST-000003']);
    expect(findOneAndUpdate).toHaveBeenCalledTimes(3);
  });

  it('passes session to the query when provided', async () => {
    const exec = jest.fn().mockResolvedValue({ next_value: 2, prefix: null });
    const sessionFn = jest.fn().mockReturnValue({ exec });
    const findOneAndUpdate = jest.fn().mockReturnValue({ session: sessionFn });
    const service = createService(findOneAndUpdate);
    const fakeSession = { id: 'session' } as never;

    await expect(
      service.allocateNextNumber(organizationId, 'estimate', fakeSession),
    ).resolves.toBe('EST-000002');
    expect(sessionFn).toHaveBeenCalledWith(fakeSession);
  });

  it('retries allocate on concurrent upsert duplicate key (11000)', async () => {
    const duplicate = Object.assign(new Error('E11000 duplicate key'), {
      code: 11000,
    });
    const execFail = jest.fn().mockRejectedValue(duplicate);
    const execOk = jest.fn().mockResolvedValue({ next_value: 7, prefix: null });
    const findOneAndUpdate = jest
      .fn()
      .mockReturnValueOnce({ exec: execFail })
      .mockReturnValueOnce({ exec: execOk });

    const service = createService(findOneAndUpdate);

    await expect(
      service.allocateNextNumber(organizationId, 'estimate'),
    ).resolves.toBe('EST-000007');
    expect(findOneAndUpdate).toHaveBeenCalledTimes(2);
  });

  it('rejects next_number at or below highest already allocated', async () => {
    // ensureCounter upsert
    const ensureExec = jest
      .fn()
      .mockResolvedValue({ next_value: 5, prefix: null });
    // conditional update finds nothing (stored next_value is 5, cannot set next to 5)
    const setExec = jest.fn().mockResolvedValue(null);
    // getNumberingConfig findOne
    const findOne = jest.fn().mockReturnValue({
      exec: jest.fn().mockResolvedValue({ next_value: 5, prefix: null }),
    });

    const findOneAndUpdate = jest
      .fn()
      .mockReturnValueOnce({ exec: ensureExec })
      .mockReturnValueOnce({ exec: setExec });

    const service = new DocumentNumbersService({
      findOneAndUpdate,
      findOne,
    } as never);

    await expect(
      service.setNextNumber(organizationId, 'estimate', 5),
    ).rejects.toThrow(/at least 6/);
  });

  it('allows setting next_number equal to current next (no-op raise to same)', async () => {
    const ensureExec = jest
      .fn()
      .mockResolvedValue({ next_value: 5, prefix: 'EST' });
    const setExec = jest.fn().mockResolvedValue({
      next_value: 5,
      prefix: 'EST',
    });
    const findOneAndUpdate = jest
      .fn()
      .mockReturnValueOnce({ exec: ensureExec })
      .mockReturnValueOnce({ exec: setExec });

    const service = createService(findOneAndUpdate);
    const config = await service.setNextNumber(organizationId, 'estimate', 6);

    expect(config.next_number).toBe(6);
    expect(findOneAndUpdate).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        next_value: { $lt: 6 },
      }),
      { $set: { next_value: 5 } },
      expect.any(Object),
    );
  });

  it('treats unchanged next_number as success when conditional update misses', async () => {
    const ensureExec = jest
      .fn()
      .mockResolvedValue({ next_value: 5, prefix: 'EST' });
    const setExec = jest.fn().mockResolvedValue(null);
    const findOne = jest.fn().mockReturnValue({
      exec: jest.fn().mockResolvedValue({ next_value: 5, prefix: 'EST' }),
    });
    const findOneAndUpdate = jest
      .fn()
      .mockReturnValueOnce({ exec: ensureExec })
      .mockReturnValueOnce({ exec: setExec });

    const service = new DocumentNumbersService({
      findOneAndUpdate,
      findOne,
    } as never);

    await expect(
      service.setNextNumber(organizationId, 'estimate', 6),
    ).resolves.toMatchObject({ next_number: 6, highest_allocated: 5 });
  });

  it('keeps allocate unique while prefix is updated concurrently', async () => {
    let counter = 2;
    let prefix: string | null = null;

    const findOneAndUpdate = jest
      .fn()
      .mockImplementation((_filter, update) => ({
        exec: jest.fn().mockImplementation(() => {
          if (update?.$inc) {
            counter += 1;
            return Promise.resolve({ next_value: counter, prefix });
          }
          if (update?.$set?.prefix) {
            prefix = update.$set.prefix;
            return Promise.resolve({ next_value: counter, prefix });
          }
          return Promise.resolve({ next_value: counter, prefix });
        }),
      }));

    const service = createService(findOneAndUpdate);

    const [first, , third] = await Promise.all([
      service.allocateNextNumber(organizationId, 'estimate'),
      service.setPrefix(organizationId, 'estimate', 'JOB'),
      service.allocateNextNumber(organizationId, 'estimate'),
    ]);

    const allocated = [first, third].sort();
    expect(allocated[0]).not.toEqual(allocated[1]);
    expect(new Set(allocated).size).toBe(2);
    // Numbers remain unique regardless of which prefix each saw mid-update
    expect(allocated.every((n) => /-(000003|000004)$/.test(n))).toBe(true);
  });

  it('getNumberingConfig reports next as highest_allocated + 1', async () => {
    const findOne = jest.fn().mockReturnValue({
      exec: jest.fn().mockResolvedValue({ next_value: 10, prefix: 'INV' }),
    });
    const service = new DocumentNumbersService({
      findOneAndUpdate: jest.fn(),
      findOne,
    } as never);

    await expect(
      service.getNumberingConfig(organizationId, 'invoice'),
    ).resolves.toEqual({
      prefix: 'INV',
      next_number: 11,
      highest_allocated: 10,
    });
  });
});
