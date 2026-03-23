import { ValidationPipe } from '@nestjs/common';
import { JobStatus } from '../../common/enums/job-status.enum';
import { PaymentType } from '../../common/enums/payment-type.enum';
import { CreateJobDto } from './create-job.dto';
import { UpdateJobDto } from './update-job.dto';

describe('job write DTOs', () => {
  const pipe = new ValidationPipe({
    transform: true,
    whitelist: true,
    forbidNonWhitelisted: true,
  });

  it('accepts valid mongo ids for create payloads', async () => {
    const transformed = (await pipe.transform(
      {
        title: 'Brake Inspection',
        customer_id: '507f1f77bcf86cd799439011',
        vehicle_id: '507f1f77bcf86cd799439012',
        assigned_user_id: '507f1f77bcf86cd799439013',
        scheduled_start: '2026-03-20T09:00:00.000Z',
        scheduled_end: '2026-03-20T10:00:00.000Z',
        job_status: JobStatus.SCHEDULED,
        payment_type: PaymentType.POS_CARD,
      },
      {
        type: 'body',
        metatype: CreateJobDto,
      },
    )) as CreateJobDto;

    expect(transformed.customer_id).toBe('507f1f77bcf86cd799439011');
    expect(transformed.vehicle_id).toBe('507f1f77bcf86cd799439012');
    expect(transformed.assigned_user_id).toBe('507f1f77bcf86cd799439013');
  });

  it('rejects malformed ids for create and update payloads', async () => {
    await expect(
      pipe.transform(
        {
          title: 'Brake Inspection',
          customer_id: 'bad-customer',
          vehicle_id: 'bad-vehicle',
        },
        {
          type: 'body',
          metatype: CreateJobDto,
        },
      ),
    ).rejects.toThrow();

    await expect(
      pipe.transform(
        {
          customer_id: 'bad-customer',
          assigned_user_id: 'bad-user',
        },
        {
          type: 'body',
          metatype: UpdateJobDto,
        },
      ),
    ).rejects.toThrow();
  });
});
