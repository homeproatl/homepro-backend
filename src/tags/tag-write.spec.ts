import { NotFoundException } from '@nestjs/common';
import { Types } from 'mongoose';
import { prepareEmbeddedTags } from './tag-write';

describe('prepareEmbeddedTags', () => {
  it('keeps reusable tags canonical and inline tags deduped', async () => {
    const reusableId = new Types.ObjectId();
    const exec = jest.fn().mockResolvedValue([
      {
        _id: reusableId,
        scope: 'LABOR',
        name: 'Priority',
        color: 'red',
      },
    ]);
    const find = jest.fn().mockReturnValue({ exec });

    const result = await prepareEmbeddedTags(
      { find } as never,
      [
        { id: String(reusableId), scope: 'LABOR', name: 'ignored', color: 'blue' },
        { id: null, scope: 'LABOR', name: 'Waiter', color: 'green' },
        { id: null, scope: 'LABOR', name: 'Waiter', color: 'green' },
      ],
      'LABOR',
    );

    expect(result).toEqual([
      {
        tag_id: reusableId,
        scope: 'LABOR',
        name: 'Priority',
        color: 'red',
      },
      {
        tag_id: null,
        scope: 'LABOR',
        name: 'Waiter',
        color: 'green',
      },
    ]);
  });

  it('rejects missing reusable tags', async () => {
    const find = jest.fn().mockReturnValue({
      exec: jest.fn().mockResolvedValue([]),
    });

    await expect(
      prepareEmbeddedTags({ find } as never, [
        {
          id: String(new Types.ObjectId()),
          scope: 'PART',
          name: 'Missing',
          color: 'red',
        },
      ], 'PART'),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('dedupes inline tags when only internal whitespace differs', async () => {
    const find = jest.fn().mockReturnValue({
      exec: jest.fn().mockResolvedValue([]),
    });

    const result = await prepareEmbeddedTags(
      { find } as never,
      [
        { id: null, scope: 'LABOR', name: 'Parts Arrived', color: 'green' },
        { id: null, scope: 'LABOR', name: 'Parts  Arrived', color: 'green' },
      ],
      'LABOR',
    );

    expect(result).toEqual([
      {
        tag_id: null,
        scope: 'LABOR',
        name: 'Parts Arrived',
        color: 'green',
      },
    ]);
  });
});
