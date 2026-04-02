import { ValidationPipe } from '@nestjs/common';
import { EstimateStatus } from '../../common/enums/estimate-status.enum';
import { CalendarEstimatesQueryDto } from './calendar-estimates-query.dto';

describe('CalendarEstimatesQueryDto', () => {
  const pipe = new ValidationPipe({
    transform: true,
    whitelist: true,
    forbidNonWhitelisted: true,
  });

  it('accepts valid query values', async () => {
    const transformed = (await pipe.transform(
      {
        date_from: '2026-03-16T00:00:00.000Z',
        date_to: '2026-03-23T00:00:00.000Z',
        assigned_user_id: '507f1f77bcf86cd799439011',
        status: EstimateStatus.SCHEDULED,
      },
      {
        type: 'query',
        metatype: CalendarEstimatesQueryDto,
      },
    )) as CalendarEstimatesQueryDto;

    expect(transformed).toEqual({
      date_from: '2026-03-16T00:00:00.000Z',
      date_to: '2026-03-23T00:00:00.000Z',
      assigned_user_id: '507f1f77bcf86cd799439011',
      status: EstimateStatus.SCHEDULED,
    });
  });

  it('rejects malformed values', async () => {
    await expect(
      pipe.transform(
        {
          date_from: 'invalid',
          assigned_user_id: 'not-an-id',
          status: 'BROKEN',
        },
        {
          type: 'query',
          metatype: CalendarEstimatesQueryDto,
        },
      ),
    ).rejects.toThrow();
  });
});
