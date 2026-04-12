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
    } as never, {} as never, {} as never);

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
    } as never, {} as never, {} as never);

    await expect(
      service.create({ scope: 'LABOR', name: ' Priority ', color: 'blue' }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('updates a reusable tag and propagates the new display values', async () => {
    const tagSave = jest.fn().mockResolvedValue(undefined);
    const estimateSave = jest.fn().mockResolvedValue(undefined);

    const service = new TagsService(
      {
        findById: jest.fn().mockReturnValue({
          exec: jest.fn().mockResolvedValue({
            _id: 'tag-1',
            scope: 'LABOR',
            name: 'Priority',
            color: 'red',
            save: tagSave,
            toObject: () => ({
              _id: 'tag-1',
              created_at: '2026-04-10T00:00:00.000Z',
              updated_at: '2026-04-11T00:00:00.000Z',
            }),
          }),
        }),
        findOne: jest.fn().mockReturnValue({
          exec: jest.fn().mockResolvedValue(null),
        }),
      } as never,
      {
        find: jest.fn().mockReturnValue({
          exec: jest.fn().mockResolvedValue([
            {
              services: [
                {
                  labor_lines: [
                    {
                      tags: [
                        { tag_id: 'tag-1', scope: 'LABOR', name: 'Priority', color: 'red' },
                      ],
                    },
                  ],
                  part_lines: [],
                },
              ],
              save: estimateSave,
            },
          ]),
        }),
      } as never,
      {
        find: jest.fn().mockReturnValue({
          exec: jest.fn().mockResolvedValue([]),
        }),
      } as never,
    );

    const updated = await service.update('tag-1', { name: 'Urgent', color: 'blue' });

    expect(updated).toMatchObject({
      id: 'tag-1',
      scope: 'LABOR',
      name: 'Urgent',
      color: 'blue',
    });
    expect(tagSave).toHaveBeenCalled();
    expect(estimateSave).toHaveBeenCalled();
  });
});
