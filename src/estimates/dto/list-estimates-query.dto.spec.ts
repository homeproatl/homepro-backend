import { ValidationPipe } from '@nestjs/common';
import { ListEstimatesQueryDto } from './list-estimates-query.dto';

describe('ListEstimatesQueryDto', () => {
  const pipe = new ValidationPipe({
    transform: true,
    whitelist: true,
    forbidNonWhitelisted: true,
  });

  it('accepts valid customer and vehicle filters', async () => {
    const transformed = (await pipe.transform(
      {
        customer_id: '507f1f77bcf86cd799439011',
        vehicle_id: '507f1f77bcf86cd799439012',
        invoice_status: 'STALE',
        ready_to_invoice: 'true',
        overdue: 'false',
      },
      {
        type: 'query',
        metatype: ListEstimatesQueryDto,
      },
    )) as ListEstimatesQueryDto;

    expect(transformed).toEqual({
      customer_id: '507f1f77bcf86cd799439011',
      vehicle_id: '507f1f77bcf86cd799439012',
      invoice_status: 'STALE',
      ready_to_invoice: true,
      overdue: false,
    });
  });

  it('accepts pagination, search, status, and sort filters', async () => {
    const transformed = (await pipe.transform(
      {
        paginated: 'true',
        page: '2',
        page_size: '25',
        search: 'brake',
        status: 'SCHEDULED',
        sort: 'newest',
      },
      {
        type: 'query',
        metatype: ListEstimatesQueryDto,
      },
    )) as ListEstimatesQueryDto;

    expect(transformed).toEqual({
      paginated: true,
      page: 2,
      page_size: 25,
      search: 'brake',
      status: 'SCHEDULED',
      sort: 'newest',
    });
  });

  it('rejects malformed ids', async () => {
    await expect(
      pipe.transform(
        {
          customer_id: 'bad-customer',
          vehicle_id: 'bad-vehicle',
        },
        {
          type: 'query',
          metatype: ListEstimatesQueryDto,
        },
      ),
    ).rejects.toThrow();
  });

  it('rejects malformed invoice filters', async () => {
    await expect(
      pipe.transform(
        {
          invoice_status: 'SENT_BUT_NOPE',
          ready_to_invoice: 'maybe',
        },
        {
          type: 'query',
          metatype: ListEstimatesQueryDto,
        },
      ),
    ).rejects.toThrow();
  });
});
