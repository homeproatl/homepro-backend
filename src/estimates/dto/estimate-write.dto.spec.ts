import { ValidationPipe } from '@nestjs/common';
import { EstimateStatus } from '../../common/enums/estimate-status.enum';
import { PaymentType } from '../../common/enums/payment-type.enum';
import { CreateEstimateDto } from './create-estimate.dto';
import { UpdateEstimateDto } from './update-estimate.dto';

describe('estimate write DTOs', () => {
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
        estimate_status: EstimateStatus.SCHEDULED,
        payment_type: PaymentType.POS_CARD,
        subtotal: '460',
        tax_rate: '8.875',
        tax_amount: '40.83',
        total: '500.83',
        services: [
          {
            name: 'Brake Service',
            labor_lines: [
              {
                description: 'Brake labor',
                assigned_user_id: '507f1f77bcf86cd799439014',
                hours: 1,
                rate: 100,
                discount_percent: 0,
                is_completed: true,
              },
            ],
            part_lines: [
              {
                name: 'Brake pad set',
                part_number: '  BP-100  ',
                quantity: 1,
                price: 80,
                cost: 50,
                discount_percent: 0,
              },
            ],
          },
        ],
      },
      {
        type: 'body',
        metatype: CreateEstimateDto,
      },
    )) as CreateEstimateDto;

    expect(transformed.customer_id).toBe('507f1f77bcf86cd799439011');
    expect(transformed.vehicle_id).toBe('507f1f77bcf86cd799439012');
    expect(transformed.assigned_user_id).toBe('507f1f77bcf86cd799439013');
    expect(transformed.subtotal).toBe(460);
    expect(transformed.tax_rate).toBe(8.875);
    expect(transformed.tax_amount).toBe(40.83);
    expect(transformed.total).toBe(500.83);
    expect(transformed.services[0].labor_lines[0].assigned_user_id).toBe(
      '507f1f77bcf86cd799439014',
    );
    expect(transformed.services[0].labor_lines[0].is_completed).toBe(true);
    expect(transformed.services[0].part_lines[0].part_number).toBe('BP-100');
  });

  it('rejects malformed ids for create and update payloads', async () => {
    await expect(
      pipe.transform(
        {
          title: 'Brake Inspection',
          customer_id: 'bad-customer',
          vehicle_id: 'bad-vehicle',
          services: [
            {
              name: 'Brake Service',
              labor_lines: [
                {
                  description: 'Brake labor',
                  hours: 1,
                  rate: 100,
                  discount_percent: 0,
                },
              ],
              part_lines: [
                {
                  name: 'Brake pad set',
                  quantity: 1,
                  price: 80,
                  cost: 50,
                  discount_percent: 0,
                },
              ],
            },
          ],
        },
        {
          type: 'body',
          metatype: CreateEstimateDto,
        },
      ),
    ).rejects.toThrow();

    await expect(
      pipe.transform(
        {
          customer_id: 'bad-customer',
          assigned_user_id: 'bad-user',
          services: [
            {
              name: 'Brake Service',
              labor_lines: [
                {
                  description: 'Brake labor',
                  assigned_user_id: 'bad-user',
                  hours: 1,
                  rate: 100,
                  discount_percent: 0,
                },
              ],
              part_lines: [],
            },
          ],
        },
        {
          type: 'body',
          metatype: UpdateEstimateDto,
        },
      ),
    ).rejects.toThrow();
  });

  it('rejects create and update payloads without at least one service', async () => {
    await expect(
      pipe.transform(
        {
          title: 'Brake Inspection',
          customer_id: '507f1f77bcf86cd799439011',
          vehicle_id: '507f1f77bcf86cd799439012',
          services: [],
        },
        {
          type: 'body',
          metatype: CreateEstimateDto,
        },
      ),
    ).rejects.toThrow();

    await expect(
      pipe.transform(
        {
          services: [],
        },
        {
          type: 'body',
          metatype: UpdateEstimateDto,
        },
      ),
    ).rejects.toThrow();
  });

  it('trims and rejects blank labor and part labels', async () => {
    await expect(
      pipe.transform(
        {
          title: 'Brake Inspection',
          customer_id: '507f1f77bcf86cd799439011',
          vehicle_id: '507f1f77bcf86cd799439012',
          services: [
            {
              name: 'Brake Service',
              labor_lines: [
                {
                  description: '   ',
                  hours: 1,
                  rate: 100,
                  discount_percent: 0,
                },
              ],
              part_lines: [
                {
                  name: 'Brake pad set',
                  quantity: 1,
                  price: 80,
                  cost: 50,
                  discount_percent: 0,
                },
              ],
            },
          ],
        },
        {
          type: 'body',
          metatype: CreateEstimateDto,
        },
      ),
    ).rejects.toThrow();

    const transformed = (await pipe.transform(
      {
        title: 'Brake Inspection',
        customer_id: '507f1f77bcf86cd799439011',
        vehicle_id: '507f1f77bcf86cd799439012',
        services: [
          {
            name: 'Brake Service',
            labor_lines: [
              {
                description: '  Brake labor  ',
                hours: 1,
                rate: 100,
                discount_percent: 0,
              },
            ],
            part_lines: [
              {
                name: '  Brake pad set  ',
                quantity: 1,
                price: 80,
                cost: 50,
                discount_percent: 0,
              },
            ],
          },
        ],
      },
      {
        type: 'body',
        metatype: CreateEstimateDto,
      },
    )) as CreateEstimateDto;

    expect(transformed.services[0].labor_lines[0].description).toBe(
      'Brake labor',
    );
    expect(transformed.services[0].part_lines[0].name).toBe('Brake pad set');
  });
});
