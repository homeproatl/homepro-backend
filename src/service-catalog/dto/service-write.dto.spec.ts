import { ValidationPipe } from '@nestjs/common';
import { CreateServiceDto } from './create-service.dto';
import { UpdateServiceDto } from './update-service.dto';

describe('service write DTOs', () => {
  const pipe = new ValidationPipe({
    transform: true,
    whitelist: true,
    forbidNonWhitelisted: true,
  });

  it('requires grouped labor and part arrays on create payloads', async () => {
    const transformed = (await pipe.transform(
      {
        name: '  Oil Change  ',
        labor_lines: [
          {
            description: '  Oil labor  ',
            hours: 1,
            rate: 100,
            discount_percent: 0,
          },
        ],
        part_lines: [
          {
            name: '  Engine oil  ',
            quantity: 1,
            cost: 20,
            price: 35,
            discount_percent: 0,
          },
        ],
      },
      {
        type: 'body',
        metatype: CreateServiceDto,
      },
    )) as CreateServiceDto;

    expect(transformed.name).toBe('Oil Change');
    expect(transformed.labor_lines[0].description).toBe('Oil labor');
    expect(transformed.part_lines[0].name).toBe('Engine oil');
    await expect(
      pipe.transform(
        {
          name: 'Oil Change',
          labor_lines: [],
        },
        {
          type: 'body',
          metatype: CreateServiceDto,
        },
      ),
    ).rejects.toThrow();
  });

  it('accepts grouped labor and part updates', async () => {
    const transformed = (await pipe.transform(
      {
        labor_lines: [
          {
            description: 'Brake labor',
            hours: 2,
            rate: 100,
            discount_percent: 5,
          },
        ],
      },
      {
        type: 'body',
        metatype: UpdateServiceDto,
      },
    )) as UpdateServiceDto;

    expect(transformed.labor_lines?.[0].hours).toBe(2);
  });

  it('rejects blank grouped line labels', async () => {
    await expect(
      pipe.transform(
        {
          name: 'Oil Change',
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
              name: 'Engine oil',
              quantity: 1,
              cost: 20,
              price: 35,
              discount_percent: 0,
            },
          ],
        },
        {
          type: 'body',
          metatype: CreateServiceDto,
        },
      ),
    ).rejects.toThrow();

    await expect(
      pipe.transform(
        {
          part_lines: [
            {
              name: '   ',
              quantity: 1,
              cost: 20,
              price: 35,
              discount_percent: 0,
            },
          ],
        },
        {
          type: 'body',
          metatype: UpdateServiceDto,
        },
      ),
    ).rejects.toThrow();
  });
});
