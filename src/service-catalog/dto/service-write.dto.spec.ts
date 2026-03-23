import { ValidationPipe } from '@nestjs/common';
import { CreateServiceDto } from './create-service.dto';
import { UpdateServiceDto } from './update-service.dto';

describe('service write DTOs', () => {
  const pipe = new ValidationPipe({
    transform: true,
    whitelist: true,
    forbidNonWhitelisted: true,
  });

  it('requires base_price on create payloads', async () => {
    const transformed = (await pipe.transform(
      {
        name: 'Oil Change',
        base_price: 50,
      },
      {
        type: 'body',
        metatype: CreateServiceDto,
      },
    )) as CreateServiceDto;

    expect(transformed.base_price).toBe(50);

    await expect(
      pipe.transform(
        {
          name: 'Oil Change',
        },
        {
          type: 'body',
          metatype: CreateServiceDto,
        },
      ),
    ).rejects.toThrow();
  });

  it('rejects null base_price updates', async () => {
    await expect(
      pipe.transform(
        {
          base_price: null,
        },
        {
          type: 'body',
          metatype: UpdateServiceDto,
        },
      ),
    ).rejects.toThrow();
  });
});
