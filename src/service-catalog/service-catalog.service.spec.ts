import { ServiceCatalogService } from './service-catalog.service';

describe('ServiceCatalogService', () => {
  it('upserts minimal catalog entries idempotently', async () => {
    const exec = jest.fn<Promise<void>, []>().mockResolvedValue(undefined);
    const updateOne = jest.fn().mockReturnValue({ exec });
    const service = new ServiceCatalogService({ updateOne } as never);

    await service.ensureMinimalCatalog();

    expect(updateOne).toHaveBeenCalledTimes(3);
    const [filter, update, options] = updateOne.mock.calls[0] as [
      { name: string },
      { $setOnInsert: { name: string } },
      { upsert: boolean },
    ];
    expect(filter).toEqual({ name: 'Oil Change' });
    expect(update.$setOnInsert).toEqual(
      expect.objectContaining({ name: 'Oil Change' }),
    );
    expect(options).toEqual({ upsert: true });
  });
});
