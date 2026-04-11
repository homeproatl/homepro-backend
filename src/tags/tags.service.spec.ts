import { ConflictException } from '@nestjs/common';
import { TagsService } from './tags.service';

describe('TagsService', () => {
  it('serializes reusable tags from the catalog', async () => {
    const service = new TagsService({
      find: jest.fn().mockReturnValue({
        sort: jest.fn().mockReturnValue({
          exec: jest.fn().mockResolvedValue([
            {
              _id: 'tag-1',
              scope: 'LABOR',
              name: 'Priority',
              color: 'red',
              toObject: () => ({
                _id: 'tag-1',
                created_at: '2026-04-10T00:00:00.000Z',
                updated_at: '2026-04-10T00:00:00.000Z',
              }),
            },
          ]),
        }),
      }),
    } as never);

    await expect(service.findAll('LABOR')).resolves.toEqual([
      {
        id: 'tag-1',
        scope: 'LABOR',
        name: 'Priority',
        color: 'red',
        created_at: '2026-04-10T00:00:00.000Z',
        updated_at: '2026-04-10T00:00:00.000Z',
      },
    ]);
  });

  it('rejects duplicate reusable tag names', async () => {
    const service = new TagsService({
      findOne: jest.fn().mockReturnValue({
        exec: jest.fn().mockResolvedValue({
          _id: 'tag-1',
          scope: 'LABOR',
          name: 'Priority',
          color: 'red',
          toObject: () => ({
            _id: 'tag-1',
            created_at: null,
            updated_at: null,
          }),
        }),
      }),
    } as never);

    await expect(
      service.create({ scope: 'LABOR', name: ' Priority ', color: 'blue' }),
    ).rejects.toBeInstanceOf(ConflictException);
  });
});
