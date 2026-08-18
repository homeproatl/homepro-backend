import { ValidationPipe } from '@nestjs/common';
import { CreateClientDto } from './create-client.dto';
import { UpdateClientDto } from './update-client.dto';
import { ListClientsQueryDto } from './list-clients-query.dto';
import { CLIENT_FIELD_LIMITS } from '../schemas/client.schema';

describe('Client DTOs', () => {
  const pipe = new ValidationPipe({
    transform: true,
    whitelist: true,
    forbidNonWhitelisted: true,
  });

  it('accepts partial create payloads and normalizes email/phone', async () => {
    const transformed = (await pipe.transform(
      {
        company_name: '  Acme Co  ',
        email: '  Owner@Example.COM ',
        phone: ' 555  0100 ',
        billing_address: {
          street: ' 1 Main St ',
          city: 'Austin',
          state: 'TX',
          postal_code: '78701',
        },
      },
      {
        type: 'body',
        metatype: CreateClientDto,
      },
    )) as CreateClientDto;

    expect(transformed).toEqual({
      company_name: 'Acme Co',
      email: 'owner@example.com',
      phone: '555 0100',
      billing_address: {
        street: '1 Main St',
        city: 'Austin',
        state: 'TX',
        postal_code: '78701',
      },
    });
  });

  it('allows missing email, phone, and addresses', async () => {
    const transformed = (await pipe.transform(
      {
        first_name: 'Ada',
      },
      {
        type: 'body',
        metatype: CreateClientDto,
      },
    )) as CreateClientDto;

    expect(transformed).toEqual({
      first_name: 'Ada',
    });
  });

  it('rejects malformed phones while preserving Joist-compatible formatting', async () => {
    await expect(
      pipe.transform(
        { display_name: 'Invalid Phone', phone: 'Darline' },
        { type: 'body', metatype: CreateClientDto },
      ),
    ).rejects.toBeDefined();

    await expect(
      pipe.transform(
        { display_name: 'Valid Phone', phone: '+1 (404) 555-0100' },
        { type: 'body', metatype: CreateClientDto },
      ),
    ).resolves.toMatchObject({ phone: '+1 (404) 555-0100' });
  });

  it('rejects unknown fields', async () => {
    await expect(
      pipe.transform(
        {
          first_name: 'Ada',
          unexpected: true,
        },
        {
          type: 'body',
          metatype: CreateClientDto,
        },
      ),
    ).rejects.toBeDefined();
  });

  it('rejects unknown nested address fields', async () => {
    await expect(
      pipe.transform(
        {
          company_name: 'Acme',
          billing_address: {
            street: '1 Main St',
            gate_code: '1234',
          },
        },
        {
          type: 'body',
          metatype: CreateClientDto,
        },
      ),
    ).rejects.toBeDefined();
  });

  it('enforces maximum field lengths and service address count', async () => {
    await expect(
      pipe.transform(
        {
          display_name: 'x'.repeat(CLIENT_FIELD_LIMITS.display_name + 1),
        },
        {
          type: 'body',
          metatype: CreateClientDto,
        },
      ),
    ).rejects.toBeDefined();

    await expect(
      pipe.transform(
        {
          company_name: 'Acme',
          service_addresses: Array.from(
            { length: CLIENT_FIELD_LIMITS.service_addresses + 1 },
            () => ({ city: 'Austin' }),
          ),
        },
        {
          type: 'body',
          metatype: CreateClientDto,
        },
      ),
    ).rejects.toBeDefined();
  });

  it('accepts nulls on update for optional identity fields', async () => {
    const transformed = (await pipe.transform(
      {
        email: null,
        phone: null,
        billing_address: null,
      },
      {
        type: 'body',
        metatype: UpdateClientDto,
      },
    )) as UpdateClientDto;

    expect(transformed).toEqual({
      email: null,
      phone: null,
      billing_address: null,
    });
  });

  it('caps list page_size at the project maximum', async () => {
    await expect(
      pipe.transform(
        {
          page_size: String(CLIENT_FIELD_LIMITS.page_size_max + 1),
        },
        {
          type: 'query',
          metatype: ListClientsQueryDto,
        },
      ),
    ).rejects.toBeDefined();

    const transformed = (await pipe.transform(
      {
        page: '2',
        page_size: '50',
        search: ' acme ',
        is_archived: 'false',
      },
      {
        type: 'query',
        metatype: ListClientsQueryDto,
      },
    )) as ListClientsQueryDto;

    expect(transformed).toEqual({
      page: 2,
      page_size: 50,
      search: 'acme',
      is_archived: false,
    });
  });
});
