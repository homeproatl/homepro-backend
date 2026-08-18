/* eslint-disable @typescript-eslint/no-unsafe-assignment */
import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { ClientsService } from './clients.service';

const ORG_ID = '507f1f77bcf86cd7994390aa';
const CLIENT_ID = '507f1f77bcf86cd799439011';

function buildService(overrides?: {
  clientModel?: object;
  documentModel?: object;
  auditLogModel?: object;
}) {
  const clientModel = {
    findOne: jest.fn().mockReturnValue({
      select: jest.fn().mockReturnValue({
        exec: jest.fn().mockResolvedValue(null),
      }),
    }),
    ...(overrides?.clientModel ?? {}),
  };
  return new ClientsService(
    clientModel as never,
    (overrides?.documentModel ?? {
      countDocuments: jest.fn().mockReturnValue({
        exec: jest.fn().mockResolvedValue(0),
      }),
    }) as never,
    (overrides?.auditLogModel ?? { create: jest.fn() }) as never,
  );
}

describe('ClientsService', () => {
  it('serializes client responses with contractor contract fields', async () => {
    const createdAt = new Date('2026-04-03T08:00:00.000Z');
    const updatedAt = new Date('2026-04-03T09:00:00.000Z');
    const service = buildService({
      clientModel: {
        create: jest.fn().mockResolvedValue({
          _id: CLIENT_ID,
          display_name: 'Home Pro Owner',
          first_name: 'Home Pro',
          last_name: 'Owner',
          company_name: null,
          phone: '555-0100',
          secondary_phone: null,
          email: 'joseph@homepro.test',
          billing_address: null,
          service_addresses: [],
          notes: null,
          is_archived: false,
          created_at: createdAt,
          updated_at: updatedAt,
        }),
      },
    });

    await expect(
      service.create(
        {
          first_name: 'Home Pro',
          last_name: 'Owner',
          phone: '555-0100',
          email: 'Home Pro@Example.com',
        },
        ORG_ID,
      ),
    ).resolves.toEqual({
      id: CLIENT_ID,
      display_name: 'Home Pro Owner',
      first_name: 'Home Pro',
      last_name: 'Owner',
      company_name: null,
      phone: '555-0100',
      secondary_phone: null,
      email: 'joseph@homepro.test',
      billing_address: null,
      service_addresses: [],
      notes: null,
      is_archived: false,
      created_at: createdAt.toISOString(),
      updated_at: updatedAt.toISOString(),
    });
  });

  it('allows partial client records with company-only identity', async () => {
    const create = jest.fn().mockResolvedValue({
      _id: CLIENT_ID,
      display_name: 'Acme Roofing',
      first_name: null,
      last_name: null,
      company_name: 'Acme Roofing',
      phone: null,
      secondary_phone: null,
      email: null,
      billing_address: null,
      service_addresses: [],
      notes: null,
      is_archived: false,
      created_at: new Date('2026-04-03T08:00:00.000Z'),
      updated_at: new Date('2026-04-03T08:00:00.000Z'),
    });
    const service = buildService({ clientModel: { create } });

    await expect(
      service.create({ company_name: 'Acme Roofing' }, ORG_ID),
    ).resolves.toMatchObject({
      display_name: 'Acme Roofing',
      company_name: 'Acme Roofing',
      email: null,
      phone: null,
    });
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        company_name: 'Acme Roofing',
        display_name: 'Acme Roofing',
        search_company: 'acme roofing',
        is_archived: false,
      }),
    );
  });

  it('rejects clients with no identifying fields', async () => {
    const service = buildService();
    await expect(service.create({}, ORG_ID)).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('rejects duplicate normalized email or phone identities', async () => {
    const exec = jest.fn().mockResolvedValue({
      _id: CLIENT_ID,
      display_name: 'Existing Client',
      contact_keys: ['email:owner@example.com', 'phone:4045550100'],
      search_email: 'owner example com',
    });
    const service = buildService({
      clientModel: {
        findOne: jest.fn().mockReturnValue({
          select: jest.fn().mockReturnValue({ exec }),
        }),
      },
    });

    await expect(
      service.create(
        {
          display_name: 'Duplicate',
          email: 'OWNER@example.com',
          phone: '(404) 555-0100',
        },
        ORG_ID,
      ),
    ).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'CLIENT_CONTACT_EXISTS' }),
    });
  });

  it('builds tokenized search across name, company, email, phone, and address', async () => {
    const exec = jest.fn().mockResolvedValue([]);
    const sort = jest.fn().mockReturnValue({ exec });
    const find = jest.fn().mockReturnValue({ sort });
    const service = buildService({ clientModel: { find } });

    await service.findAll({ search: 'acme 555 austin' }, ORG_ID);

    expect(find).toHaveBeenCalledWith(
      expect.objectContaining({
        organization_id: expect.anything(),
        $and: [
          expect.objectContaining({
            $or: expect.arrayContaining([
              { company_name: /acme/i },
              { search_company: /acme/i },
            ]),
          }),
          expect.objectContaining({
            $or: expect.arrayContaining([
              { search_phone: /555/ },
              { phone: /555/i },
            ]),
          }),
          expect.objectContaining({
            $or: expect.arrayContaining([
              { 'billing_address.city': /austin/i },
              { search_addresses: /austin/i },
            ]),
          }),
        ],
      }),
    );
  });

  it('bounds tokenized client search clauses to avoid excessive regex fan-out', async () => {
    const exec = jest.fn().mockResolvedValue([]);
    const sort = jest.fn().mockReturnValue({ exec });
    const find = jest.fn().mockReturnValue({ sort });
    const service = buildService({ clientModel: { find } });

    await service.findAll(
      { search: 'one two three four five six seven eight' },
      ORG_ID,
    );

    expect(find).toHaveBeenCalledWith(
      expect.objectContaining({
        $and: [
          expect.any(Object),
          expect.any(Object),
          expect.any(Object),
          expect.any(Object),
          expect.any(Object),
          expect.any(Object),
        ],
      }),
    );
  });

  it('paginates with a stable sort tie-breaker and maximum page size', async () => {
    const execFind = jest.fn().mockResolvedValue([]);
    const limit = jest.fn().mockReturnValue({ exec: execFind });
    const skip = jest.fn().mockReturnValue({ limit });
    const sort = jest.fn().mockReturnValue({ skip });
    const find = jest.fn().mockReturnValue({ sort });
    const countDocuments = jest.fn().mockReturnValue({
      exec: jest.fn().mockResolvedValue(0),
    });
    const service = buildService({
      clientModel: { find, countDocuments },
    });

    await service.findPage({ page: 1, page_size: 500 }, ORG_ID);

    expect(sort).toHaveBeenCalledWith({
      is_archived: 1,
      created_at: -1,
      _id: -1,
    });
    expect(limit).toHaveBeenCalledWith(100);
  });

  it('clamps out-of-range page so skip matches the returned page metadata', async () => {
    const execFind = jest.fn().mockResolvedValue([
      {
        _id: CLIENT_ID,
        display_name: 'Only Page',
        first_name: null,
        last_name: null,
        company_name: 'Only Page',
        phone: null,
        secondary_phone: null,
        email: null,
        billing_address: null,
        service_addresses: [],
        notes: null,
        is_archived: false,
        created_at: new Date('2026-04-03T08:00:00.000Z'),
        updated_at: new Date('2026-04-03T08:00:00.000Z'),
      },
    ]);
    const limit = jest.fn().mockReturnValue({ exec: execFind });
    const skip = jest.fn().mockReturnValue({ limit });
    const sort = jest.fn().mockReturnValue({ skip });
    const find = jest.fn().mockReturnValue({ sort });
    const countDocuments = jest.fn().mockReturnValue({
      exec: jest.fn().mockResolvedValue(1),
    });
    const service = buildService({
      clientModel: { find, countDocuments },
    });

    await expect(
      service.findPage({ page: 9, page_size: 25 }, ORG_ID),
    ).resolves.toMatchObject({
      total: 1,
      page: 1,
      page_count: 1,
      items: [expect.objectContaining({ id: CLIENT_ID })],
    });
    expect(skip).toHaveBeenCalledWith(0);
  });

  it('applies archive-state filtering to client lists', async () => {
    const exec = jest.fn().mockResolvedValue([]);
    const sort = jest.fn().mockReturnValue({ exec });
    const find = jest.fn().mockReturnValue({ sort });
    const service = buildService({ clientModel: { find } });

    await service.findAll({ is_archived: true }, ORG_ID);

    expect(find).toHaveBeenCalledWith(
      expect.objectContaining({
        organization_id: expect.anything(),
        is_archived: true,
      }),
    );
  });

  it('returns not found for scoped-out or missing client ids', async () => {
    const service = buildService({
      clientModel: {
        findOne: jest.fn().mockReturnValue({
          exec: jest.fn().mockResolvedValue(null),
        }),
      },
    });

    await expect(service.findById(CLIENT_ID, ORG_ID)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('blocks client deletion while documents reference the client', async () => {
    const client = {
      _id: CLIENT_ID,
      toObject: () => ({ _id: CLIENT_ID }),
    };
    const documentCountDocuments = jest.fn().mockReturnValue({
      exec: jest.fn().mockResolvedValue(1),
    });
    const service = buildService({
      clientModel: {
        findOne: jest.fn().mockReturnValue({
          exec: jest.fn().mockResolvedValue(client),
        }),
      },
      documentModel: {
        countDocuments: documentCountDocuments,
      },
    });

    await expect(service.remove(CLIENT_ID, ORG_ID)).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(documentCountDocuments).toHaveBeenCalledWith(
      expect.objectContaining({
        client_id: CLIENT_ID,
        organization_id: expect.anything(),
      }),
    );
  });

  it('deletes a client when no documents reference it', async () => {
    const deleteOne = jest.fn().mockReturnValue({
      exec: jest.fn().mockResolvedValue({ deletedCount: 1 }),
    });
    const service = buildService({
      clientModel: {
        findOne: jest.fn().mockReturnValue({
          exec: jest.fn().mockResolvedValue({
            _id: CLIENT_ID,
            toObject: () => ({ _id: CLIENT_ID }),
          }),
        }),
        deleteOne,
      },
      documentModel: {
        countDocuments: jest.fn().mockReturnValue({
          exec: jest.fn().mockResolvedValue(0),
        }),
      },
      auditLogModel: {
        create: jest.fn().mockResolvedValue(undefined),
      },
    });

    await expect(service.remove(CLIENT_ID, ORG_ID)).resolves.toEqual({
      deleted: true,
    });
    expect(deleteOne).toHaveBeenCalledWith(
      expect.objectContaining({
        organization_id: expect.anything(),
        _id: CLIENT_ID,
      }),
    );
  });

  it('archives a client instead of deleting historical records', async () => {
    const save = jest.fn().mockResolvedValue(undefined);
    const client = {
      _id: CLIENT_ID,
      display_name: 'Home Pro Owner',
      first_name: 'Home Pro',
      last_name: 'Owner',
      company_name: null,
      phone: '555',
      secondary_phone: null,
      email: null,
      billing_address: null,
      service_addresses: [],
      notes: null,
      is_archived: false,
      created_at: new Date('2026-04-03T08:00:00.000Z'),
      updated_at: new Date('2026-04-03T08:00:00.000Z'),
      toObject: () => ({ _id: CLIENT_ID, is_archived: false }),
      save,
    };
    const service = buildService({
      clientModel: {
        findOne: jest.fn().mockReturnValue({
          exec: jest.fn().mockResolvedValue(client),
        }),
      },
      auditLogModel: {
        create: jest.fn().mockResolvedValue(undefined),
      },
    });

    await expect(service.archive(CLIENT_ID, ORG_ID)).resolves.toMatchObject({
      id: CLIENT_ID,
      is_archived: true,
    });
    expect(save).toHaveBeenCalled();
  });

  it('restores an archived client', async () => {
    const save = jest.fn().mockResolvedValue(undefined);
    const auditCreate = jest.fn().mockResolvedValue(undefined);
    const client = {
      _id: CLIENT_ID,
      display_name: 'Home Pro Owner',
      first_name: 'Home Pro',
      last_name: 'Owner',
      company_name: null,
      phone: '555',
      secondary_phone: null,
      email: null,
      billing_address: null,
      service_addresses: [],
      notes: null,
      is_archived: true,
      created_at: new Date('2026-04-03T08:00:00.000Z'),
      updated_at: new Date('2026-04-03T08:00:00.000Z'),
      toObject: () => ({ _id: CLIENT_ID, is_archived: true }),
      save,
    };
    const service = buildService({
      clientModel: {
        findOne: jest.fn().mockReturnValue({
          exec: jest.fn().mockResolvedValue(client),
        }),
      },
      auditLogModel: {
        create: auditCreate,
      },
    });

    await expect(service.unarchive(CLIENT_ID, ORG_ID)).resolves.toMatchObject({
      id: CLIENT_ID,
      is_archived: false,
    });
    expect(save).toHaveBeenCalled();
    expect(auditCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'client.unarchived',
      }),
    );
  });

  it('detail responses include addresses only (no document counts)', async () => {
    const service = buildService({
      clientModel: {
        findOne: jest.fn().mockReturnValue({
          exec: jest.fn().mockResolvedValue({
            _id: CLIENT_ID,
            display_name: 'Site Client',
            first_name: null,
            last_name: null,
            company_name: 'Site Client',
            phone: null,
            secondary_phone: null,
            email: null,
            billing_address: {
              street: '1 Main',
              suite: null,
              city: 'Austin',
              state: 'TX',
              postal_code: '78701',
              country: 'US',
            },
            service_addresses: [
              {
                street: '2 Oak',
                suite: null,
                city: 'Austin',
                state: 'TX',
                postal_code: '78702',
                country: 'US',
              },
            ],
            notes: 'Gate code 12',
            is_archived: false,
            created_at: new Date('2026-04-03T08:00:00.000Z'),
            updated_at: new Date('2026-04-03T08:00:00.000Z'),
          }),
        }),
      },
    });

    const detail = await service.findById(CLIENT_ID, ORG_ID);
    expect(detail).toMatchObject({
      display_name: 'Site Client',
      billing_address: expect.objectContaining({ city: 'Austin' }),
      service_addresses: [expect.objectContaining({ street: '2 Oak' })],
      notes: 'Gate code 12',
    });
    expect(detail).not.toHaveProperty('document_count');
    expect(detail).not.toHaveProperty('balance');
    expect(detail).not.toHaveProperty('vehicles');
  });
});
