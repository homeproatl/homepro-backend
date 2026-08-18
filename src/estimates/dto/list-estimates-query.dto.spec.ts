import { ValidationPipe } from '@nestjs/common';
import { ListEstimatesQueryDto } from './list-estimates-query.dto';

describe('ListEstimatesQueryDto', () => {
  const pipe = new ValidationPipe({
    transform: true,
    whitelist: true,
    forbidNonWhitelisted: true,
  });

  it('accepts canonical estimate list filters', async () => {
    const transformed = (await pipe.transform(
      {
        page: '1',
        page_size: '25',
        status: 'pending,approved',
        client_id: '507f1f77bcf86cd799439011',
        search: 'roof',
        date_from: '2026-01-01',
        date_to: '2026-01-31T23:59:59.000Z',
        amount_min_minor: '100',
        amount_max_minor: '50000',
        email_state: 'sent',
        sort: 'issue_date',
        direction: 'desc',
      },
      { type: 'query', metatype: ListEstimatesQueryDto },
    )) as ListEstimatesQueryDto;

    expect(transformed).toEqual({
      page: 1,
      page_size: 25,
      status: ['pending', 'approved'],
      client_id: '507f1f77bcf86cd799439011',
      search: 'roof',
      date_from: '2026-01-01',
      date_to: '2026-01-31T23:59:59.000Z',
      amount_min_minor: 100,
      amount_max_minor: 50_000,
      email_state: 'sent',
      sort: 'issue_date',
      direction: 'desc',
    });
  });

  it('rejects fields outside the estimate document query contract', async () => {
    await expect(
      pipe.transform(
        {
          customer_id: '507f1f77bcf86cd799439011',
          vehicle_id: '507f1f77bcf86cd799439012',
          paginated: 'true',
        },
        { type: 'query', metatype: ListEstimatesQueryDto },
      ),
    ).rejects.toThrow();
  });

  it('rejects malformed client ids', async () => {
    await expect(
      pipe.transform(
        { client_id: 'bad-client' },
        { type: 'query', metatype: ListEstimatesQueryDto },
      ),
    ).rejects.toThrow();
  });
});
