import { BadRequestException, ConflictException } from '@nestjs/common';
import { Types } from 'mongoose';
import { DocumentsService } from './documents.service';

const ORG_ID = '507f1f77bcf86cd7994390aa';
const CLIENT_ID = '507f1f77bcf86cd7994390ab';
const ACTOR_ID = '507f1f77bcf86cd7994390ac';

function activeClient(overrides: Record<string, unknown> = {}) {
  return {
    _id: new Types.ObjectId(CLIENT_ID),
    display_name: 'Pat Client',
    company_name: null,
    email: 'pat@example.com',
    phone: '555-0100',
    billing_address: null,
    service_addresses: [],
    is_archived: false,
    ...overrides,
  };
}

function createService(deps: {
  documentModel?: Record<string, unknown>;
  eventModel?: Record<string, unknown>;
  clientModel?: Record<string, unknown>;
  itemModel?: Record<string, unknown>;
  organizationModel?: Record<string, unknown>;
  appSettingsModel?: Record<string, unknown>;
  numbers?: { allocateNextNumber: jest.Mock };
  taxRates?: {
    findActiveDocumentById?: jest.Mock;
    findActiveDocumentsByIds?: jest.Mock;
  };
  contracts?: {
    findActiveDocumentById: jest.Mock;
    ensureDefaultContractTemplate?: jest.Mock;
  };
  settingsService?: { getSnapshotSource: jest.Mock };
}) {
  return new DocumentsService(
    (deps.documentModel ?? {}) as never,
    (deps.eventModel ?? { create: jest.fn().mockResolvedValue({}) }) as never,
    (deps.clientModel ?? {}) as never,
    (deps.itemModel ?? {}) as never,
    (deps.organizationModel ?? {
      findById: jest.fn().mockReturnValue({
        exec: jest.fn().mockResolvedValue({
          _id: new Types.ObjectId(ORG_ID),
          name: 'Home Pro',
        }),
      }),
    }) as never,
    (deps.appSettingsModel ?? {
      findOne: jest.fn().mockReturnValue({
        exec: jest.fn().mockResolvedValue({
          business_timezone: 'America/New_York',
        }),
      }),
    }) as never,
    (deps.numbers ?? {
      allocateNextNumber: jest.fn().mockResolvedValue('EST-000001'),
    }) as never,
    (deps.taxRates ?? {
      findActiveDocumentById: jest.fn(),
      findActiveDocumentsByIds: jest.fn(),
    }) as never,
    (deps.contracts ?? {
      findActiveDocumentById: jest.fn().mockResolvedValue({
        _id: new Types.ObjectId('507f1f77bcf86cd7994390d1'),
        body: 'Default contract body',
      }),
      ensureDefaultContractTemplate: jest.fn().mockResolvedValue({
        id: '507f1f77bcf86cd7994390d1',
      }),
    }) as never,
    (deps.settingsService ?? {
      getSnapshotSource: jest.fn().mockResolvedValue({
        business_timezone: 'America/New_York',
        account: {},
        company: {},
        documents: {},
        preferences: { currency: 'usd', locale: 'en-US' },
      }),
    }) as never,
  );
}

describe('DocumentsService', () => {
  it('create recalculates totals server-side and ignores client-supplied money', async () => {
    const createdDoc = {
      _id: new Types.ObjectId(),
      organization_id: new Types.ObjectId(ORG_ID),
      type: 'estimate',
      number: 'EST-000001',
      client_id: new Types.ObjectId(CLIENT_ID),
      status: 'draft',
      version: 1,
      line_items: [],
      subtotal_minor: 10_000,
      markup_total_minor: 0,
      discount_total_minor: 0,
      tax_total_minor: 0,
      deposit_requested_minor: 0,
      total_minor: 10_000,
      amount_paid_minor: 0,
      amount_refunded_minor: 0,
      amount_disputed_minor: 0,
      balance_due_minor: 10_000,
      client_snapshot: {
        display_name: 'Pat Client',
        company_name: null,
        email: null,
        phone: null,
        billing_address: null,
        service_address: null,
      },
      company_snapshot: {
        display_name: 'Home Pro',
        legal_name: null,
        phone: null,
        email: null,
        website: null,
        address: null,
        license_number: null,
        logo_asset_id: null,
      },
      settings_snapshot: {
        currency: 'usd',
        locale: 'en-US',
        timezone: 'America/New_York',
        payment_terms: null,
        footer: null,
      },
      email_state: 'not_sent',
      sync_state: 'not_synced',
      online_payments_enabled: false,
      auto_generate_invoice_enabled: false,
      show_client_signature: false,
      show_company_signature: false,
      document_photo_asset_ids: [],
      attachment_asset_ids: [],
      created_at: new Date('2026-01-01T00:00:00.000Z'),
      updated_at: new Date('2026-01-01T00:00:00.000Z'),
    };

    let persisted: Record<string, unknown> | undefined;
    const create = jest
      .fn()
      .mockImplementation((payload: Record<string, unknown>) => {
        persisted = payload;
        return Promise.resolve({
          ...createdDoc,
          ...payload,
          _id: createdDoc._id,
        });
      });

    const service = createService({
      clientModel: {
        findOne: jest.fn().mockReturnValue({
          exec: jest.fn().mockResolvedValue(activeClient()),
        }),
      },
      documentModel: { create },
      settingsService: {
        getSnapshotSource: jest.fn().mockResolvedValue({
          business_timezone: 'America/New_York',
          account: {},
          company: {},
          documents: {},
          preferences: { currency: 'usd', locale: 'en-US' },
        }),
      },
    });

    const result = await service.create(
      {
        type: 'estimate',
        client_id: CLIENT_ID,
        line_items: [
          {
            sort_order: 0,
            line_type: 'service',
            description: 'Roof repair',
            rate_minor: 10_000,
            quantity_milli: 1000,
            markup_type: 'none',
            markup_value: 0,
            discount_type: 'none',
            discount_value: 0,
            taxable: true,
          },
        ],
      },
      ORG_ID,
      ACTOR_ID,
    );

    expect(persisted?.total_minor).toBe(10_000);
    expect(persisted?.subtotal_minor).toBe(10_000);
    expect(persisted?.tax_total_minor).toBe(0);
    expect(
      (persisted?.line_items as Array<Record<string, unknown>>)[0],
    ).toMatchObject({
      taxable: false,
      tax_id: null,
      tax_ids: [],
      tax_rate_basis_points: 0,
      tax_amount_minor: 0,
    });
    expect(result.total_minor).toBe(10_000);
    expect(result.number).toBe('EST-000001');
    // Vehicle is never required on create payload.
    expect(persisted).not.toHaveProperty('vehicle_id');
  });

  it('sums multiple selected Joist-style tax toggles on a document line', async () => {
    let persisted: Record<string, unknown> | null = null;
    const salesTaxId = new Types.ObjectId('507f1f77bcf86cd7994390e1');
    const feeTaxId = new Types.ObjectId('507f1f77bcf86cd7994390e2');
    const create = jest.fn().mockImplementation(async (payload) => {
      persisted = payload;
      return { ...payload, _id: new Types.ObjectId(), version: 1 };
    });
    const service = createService({
      clientModel: {
        findOne: jest.fn().mockReturnValue({
          exec: jest.fn().mockResolvedValue(activeClient()),
        }),
      },
      itemModel: {
        findOne: jest.fn().mockReturnValue({
          exec: jest.fn().mockResolvedValue(null),
        }),
      },
      documentModel: { create },
      taxRates: {
        findActiveDocumentsByIds: jest.fn().mockResolvedValue([
          {
            _id: salesTaxId,
            name: 'sales',
            rate_basis_points: 700,
          },
          {
            _id: feeTaxId,
            name: 'Processing Fee',
            rate_basis_points: 400,
          },
        ]),
      },
    });

    const result = await service.create(
      {
        type: 'invoice',
        client_id: CLIENT_ID,
        line_items: [
          {
            sort_order: 0,
            line_type: 'service',
            description: 'Kitchen repair',
            rate_minor: 10_000,
            quantity_milli: 1000,
            markup_type: 'none',
            markup_value: 0,
            discount_type: 'none',
            discount_value: 0,
            taxable: true,
            tax_ids: [String(salesTaxId), String(feeTaxId)],
          },
        ],
      },
      ORG_ID,
      ACTOR_ID,
    );

    const line = (
      persisted as unknown as { line_items: Array<Record<string, unknown>> }
    ).line_items[0];
    expect(line.tax_ids).toEqual([salesTaxId, feeTaxId]);
    expect(line.tax_id).toEqual(salesTaxId);
    expect(line.tax_rate_basis_points).toBe(1100);
    expect(line.tax_amount_minor).toBe(1100);
    expect(line.tax_name_snapshot).toContain('sales');
    expect(result.tax_total_minor).toBe(1100);
    expect(result.total_minor).toBe(11_100);
  });

  it('preserves an unchanged historical tax snapshot after the tax is archived', async () => {
    const lineId = new Types.ObjectId();
    const taxId = new Types.ObjectId('507f1f77bcf86cd7994390e1');
    const findActiveDocumentsByIds = jest.fn();
    const service = createService({
      taxRates: { findActiveDocumentsByIds },
    });

    const built = await (
      service as unknown as {
        buildCalculatedLines: (
          lines: Array<Record<string, unknown>>,
          organizationId: string,
          options: Record<string, unknown>,
        ) => Promise<Array<Record<string, unknown>>>;
      }
    ).buildCalculatedLines(
      [
        {
          id: String(lineId),
          sort_order: 0,
          line_type: 'service',
          description: 'Existing taxable work',
          rate_minor: 10_000,
          quantity_milli: 1000,
          markup_type: 'none',
          markup_value: 0,
          discount_type: 'none',
          discount_value: 0,
          taxable: true,
          tax_ids: [String(taxId)],
          photo_asset_ids: [],
        },
      ],
      ORG_ID,
      {
        existingLines: [
          {
            _id: lineId,
            taxable: true,
            tax_id: taxId,
            tax_ids: [taxId],
            tax_name_snapshot: 'Sales Tax (8.000%)',
            tax_rate_basis_points: 800,
            vendor_name: null,
            internal_unit_cost_minor: null,
            waste_basis_points: 0,
            purchase_status: 'not_needed',
            photo_asset_ids: [],
          },
        ],
      },
    );

    expect(findActiveDocumentsByIds).not.toHaveBeenCalled();
    expect(built[0]).toMatchObject({
      taxable: true,
      tax_ids: [taxId],
      tax_rate_basis_points: 800,
      tax_amount_minor: 800,
      total_minor: 10_800,
    });
  });

  it('rejects inactive (archived) clients on create', async () => {
    const service = createService({
      clientModel: {
        findOne: jest.fn().mockReturnValue({
          exec: jest
            .fn()
            .mockResolvedValue(activeClient({ is_archived: true })),
        }),
      },
    });

    await expect(
      service.create(
        {
          type: 'estimate',
          client_id: CLIENT_ID,
          line_items: [
            {
              sort_order: 0,
              line_type: 'service',
              description: 'Work',
              rate_minor: 1000,
              quantity_milli: 1000,
            },
          ],
        },
        ORG_ID,
        ACTOR_ID,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects estimate expiration and invoice due dates before issue date', async () => {
    const service = createService({
      clientModel: {
        findOne: jest.fn().mockReturnValue({
          exec: jest.fn().mockResolvedValue(activeClient()),
        }),
      },
    });
    const line = {
      sort_order: 0,
      line_type: 'service' as const,
      description: 'Work',
      rate_minor: 1000,
      quantity_milli: 1000,
    };

    await expect(
      service.create(
        {
          type: 'estimate',
          client_id: CLIENT_ID,
          issue_date: '2026-08-12',
          expiration_date: '2026-08-11',
          line_items: [line],
        },
        ORG_ID,
        ACTOR_ID,
      ),
    ).rejects.toThrow(
      'Estimate expiration date cannot be before the issue date.',
    );

    await expect(
      service.create(
        {
          type: 'invoice',
          client_id: CLIENT_ID,
          issue_date: '2026-08-12',
          due_date: '2026-08-11',
          line_items: [line],
        },
        ORG_ID,
        ACTOR_ID,
      ),
    ).rejects.toThrow('Invoice due date cannot be before the issue date.');
  });

  it('returns a form-safe bad request when deposit exceeds the total', async () => {
    const service = createService({
      clientModel: {
        findOne: jest.fn().mockReturnValue({
          exec: jest.fn().mockResolvedValue(activeClient()),
        }),
      },
    });

    await expect(
      service.create(
        {
          type: 'estimate',
          client_id: CLIENT_ID,
          deposit_requested_minor: 2000,
          line_items: [
            {
              sort_order: 0,
              line_type: 'service',
              description: 'Work',
              rate_minor: 1000,
              quantity_milli: 1000,
            },
          ],
        },
        ORG_ID,
        ACTOR_ID,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('returns 409 STALE_VERSION when update version does not match', async () => {
    const existing = {
      _id: new Types.ObjectId(),
      organization_id: new Types.ObjectId(ORG_ID),
      type: 'estimate',
      status: 'draft',
      version: 3,
      updated_at: new Date('2026-02-01T00:00:00.000Z'),
      client_id: new Types.ObjectId(CLIENT_ID),
      frozen_hash: null,
      line_items: [
        {
          sort_order: 0,
          line_type: 'service',
          description: 'Work',
          rate_minor: 1000,
          quantity_milli: 1000,
          subtotal_minor: 1000,
          markup_amount_minor: 0,
          discount_amount_minor: 0,
          tax_amount_minor: 0,
          total_minor: 1000,
          markup_type: 'none',
          markup_value: 0,
          discount_type: 'none',
          discount_value: 0,
          taxable: false,
          tax_rate_basis_points: 0,
          waste_basis_points: 0,
          adjusted_quantity_milli: 1000,
          internal_cost_total_minor: 0,
          purchase_status: 'not_needed',
          photo_asset_ids: [],
        },
      ],
      deposit_requested_minor: 0,
      amount_paid_minor: 0,
      amount_refunded_minor: 0,
      amount_disputed_minor: 0,
      client_snapshot: activeClient(),
      company_snapshot: { display_name: 'Co', logo_asset_id: null },
      settings_snapshot: {
        currency: 'usd',
        locale: 'en-US',
        timezone: 'America/New_York',
        payment_terms: null,
        footer: null,
      },
    };

    const service = createService({
      documentModel: {
        findOne: jest.fn().mockReturnValue({
          exec: jest.fn().mockResolvedValue(existing),
        }),
      },
      clientModel: {
        findOne: jest.fn().mockReturnValue({
          exec: jest.fn().mockResolvedValue(activeClient()),
        }),
      },
    });

    await expect(
      service.update(
        String(existing._id),
        { version: 2, job_name: 'Stale' },
        ORG_ID,
        ACTOR_ID,
      ),
    ).rejects.toBeInstanceOf(ConflictException);

    try {
      await service.update(
        String(existing._id),
        { version: 2, job_name: 'Stale' },
        ORG_ID,
        ACTOR_ID,
      );
    } catch (error) {
      expect((error as ConflictException).getResponse()).toEqual(
        expect.objectContaining({
          code: 'STALE_VERSION',
          current_version: 3,
        }),
      );
    }
  });

  it('returns 409 for invalid status transitions', async () => {
    const existing = {
      _id: new Types.ObjectId(),
      organization_id: new Types.ObjectId(ORG_ID),
      type: 'estimate',
      status: 'draft',
      version: 1,
      updated_at: new Date(),
      client_id: new Types.ObjectId(CLIENT_ID),
      frozen_hash: null,
      frozen_revision_number: null,
      client_snapshot: activeClient(),
      company_snapshot: { display_name: 'Co' },
      settings_snapshot: {
        currency: 'usd',
        locale: 'en-US',
        timezone: 'America/New_York',
      },
      line_items: [],
    };

    const service = createService({
      documentModel: {
        findOne: jest.fn().mockReturnValue({
          exec: jest.fn().mockResolvedValue(existing),
        }),
      },
    });

    await expect(
      service.transitionStatus(
        String(existing._id),
        { status: 'approved', version: 1 },
        ORG_ID,
        ACTOR_ID,
      ),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('rejects customer-field edits while frozen but allows private_notes', async () => {
    const existing = {
      _id: new Types.ObjectId(),
      organization_id: new Types.ObjectId(ORG_ID),
      type: 'estimate',
      status: 'pending',
      version: 1,
      updated_at: new Date(),
      client_id: new Types.ObjectId(CLIENT_ID),
      frozen_hash: 'abc123',
      frozen_revision_number: 1,
      line_items: [],
      deposit_requested_minor: 0,
      amount_paid_minor: 0,
      amount_refunded_minor: 0,
      amount_disputed_minor: 0,
      po_number: null,
      job_name: 'Roof',
      customer_notes: null,
      private_notes: null,
      show_client_signature: false,
      show_company_signature: false,
      contract_template_id: null,
      contract_snapshot: null,
      client_snapshot: activeClient(),
      company_snapshot: { display_name: 'Co', logo_asset_id: null },
      settings_snapshot: {
        currency: 'usd',
        locale: 'en-US',
        timezone: 'America/New_York',
        payment_terms: null,
        footer: null,
      },
      service_address_snapshot: null,
      issue_date: null,
      expiration_date: null,
      due_date: null,
    };

    const findOneAndUpdate = jest.fn().mockReturnValue({
      exec: jest.fn().mockResolvedValue({
        ...existing,
        version: 2,
        private_notes: 'internal only',
      }),
    });

    const service = createService({
      documentModel: {
        findOne: jest.fn().mockReturnValue({
          exec: jest.fn().mockResolvedValue(existing),
          select: jest.fn().mockReturnValue({
            exec: jest.fn().mockResolvedValue(null),
          }),
        }),
        findOneAndUpdate,
      },
      clientModel: {
        findOne: jest.fn().mockReturnValue({
          exec: jest.fn().mockResolvedValue(activeClient()),
        }),
      },
    });

    try {
      await service.update(
        String(existing._id),
        { version: 1, job_name: 'Changed' },
        ORG_ID,
        ACTOR_ID,
      );
      throw new Error('expected ConflictException');
    } catch (error) {
      expect(error).toBeInstanceOf(ConflictException);
      expect((error as ConflictException).getResponse()).toEqual(
        expect.objectContaining({ code: 'DOCUMENT_FROZEN' }),
      );
    }

    await expect(
      service.update(
        String(existing._id),
        { version: 1, customer_notes: 'Hello customer' },
        ORG_ID,
        ACTOR_ID,
      ),
    ).rejects.toBeInstanceOf(ConflictException);

    await expect(
      service.update(
        String(existing._id),
        { version: 1, private_notes: 'internal only' },
        ORG_ID,
        ACTOR_ID,
      ),
    ).resolves.toBeDefined();
  });

  it('rejects all updates on archived documents', async () => {
    const existing = {
      _id: new Types.ObjectId(),
      organization_id: new Types.ObjectId(ORG_ID),
      type: 'estimate',
      status: 'archived',
      version: 2,
      updated_at: new Date(),
      client_id: new Types.ObjectId(CLIENT_ID),
      frozen_hash: null,
      line_items: [],
    };

    const service = createService({
      documentModel: {
        findOne: jest.fn().mockReturnValue({
          exec: jest.fn().mockResolvedValue(existing),
        }),
      },
    });

    try {
      await service.update(
        String(existing._id),
        { version: 2, private_notes: 'nope' },
        ORG_ID,
        ACTOR_ID,
      );
      throw new Error('expected ConflictException');
    } catch (error) {
      expect(error).toBeInstanceOf(ConflictException);
      expect((error as ConflictException).getResponse()).toEqual(
        expect.objectContaining({ code: 'DOCUMENT_ARCHIVED' }),
      );
    }
  });

  it('voids draft invoices by freezing and rejects locked edits on void', async () => {
    const existing = {
      _id: new Types.ObjectId(),
      organization_id: new Types.ObjectId(ORG_ID),
      type: 'invoice',
      status: 'draft',
      number: 'INV-000001',
      version: 1,
      updated_at: new Date(),
      client_id: new Types.ObjectId(CLIENT_ID),
      frozen_hash: null as string | null,
      frozen_revision_number: null as number | null,
      line_items: [],
      subtotal_minor: 1000,
      markup_total_minor: 0,
      discount_total_minor: 0,
      tax_total_minor: 0,
      deposit_requested_minor: 0,
      total_minor: 1000,
      amount_paid_minor: 0,
      amount_refunded_minor: 0,
      amount_disputed_minor: 0,
      balance_due_minor: 1000,
      po_number: null,
      job_name: null,
      customer_notes: null,
      contract_template_id: null,
      contract_snapshot: null,
      client_snapshot: activeClient(),
      company_snapshot: { display_name: 'Co' },
      settings_snapshot: {
        currency: 'usd',
        locale: 'en-US',
        timezone: 'America/New_York',
      },
      service_address_snapshot: null,
      issue_date: null,
      expiration_date: null,
      due_date: null,
    };

    let currentDoc: Record<string, unknown> = {
      ...existing,
      toObject: () => ({ ...existing }),
    };

    const findOneAndUpdate = jest
      .fn()
      .mockImplementation(
        (_filter: unknown, update: { $set?: Record<string, unknown> }) => {
          if (update.$set?.status === 'void') {
            expect(update.$set.frozen_hash).toEqual(expect.any(String));
            currentDoc = {
              ...existing,
              status: 'void',
              version: 2,
              frozen_hash: update.$set.frozen_hash,
              frozen_revision_number: update.$set.frozen_revision_number,
              toObject: () => ({ ...existing }),
            };
            return { exec: jest.fn().mockResolvedValue(currentDoc) };
          }
          return { exec: jest.fn().mockResolvedValue(null) };
        },
      );

    const service = createService({
      documentModel: {
        findOne: jest.fn().mockImplementation(() => ({
          exec: jest.fn().mockImplementation(() => Promise.resolve(currentDoc)),
        })),
        findOneAndUpdate,
      },
      clientModel: {
        findOne: jest.fn().mockReturnValue({
          exec: jest.fn().mockResolvedValue(activeClient()),
        }),
      },
    });

    await service.transitionStatus(
      String(existing._id),
      { status: 'void', version: 1 },
      ORG_ID,
      ACTOR_ID,
    );

    try {
      await service.update(
        String(existing._id),
        { version: 2, job_name: 'Nope' },
        ORG_ID,
        ACTOR_ID,
      );
      throw new Error('expected ConflictException');
    } catch (error) {
      expect(error).toBeInstanceOf(ConflictException);
      expect((error as ConflictException).getResponse()).toEqual(
        expect.objectContaining({ code: 'DOCUMENT_VOID' }),
      );
    }
  });

  it('does not overwrite payment ledger fields on content update', async () => {
    const existing = {
      _id: new Types.ObjectId(),
      organization_id: new Types.ObjectId(ORG_ID),
      type: 'invoice',
      status: 'draft',
      version: 1,
      updated_at: new Date(),
      client_id: new Types.ObjectId(CLIENT_ID),
      frozen_hash: null,
      line_items: [
        {
          sort_order: 0,
          line_type: 'service',
          description: 'Work',
          rate_minor: 10_000,
          quantity_milli: 1000,
          subtotal_minor: 10_000,
          markup_amount_minor: 0,
          discount_amount_minor: 0,
          tax_amount_minor: 0,
          total_minor: 10_000,
          markup_type: 'none',
          markup_value: 0,
          discount_type: 'none',
          discount_value: 0,
          taxable: false,
          tax_rate_basis_points: 0,
          waste_basis_points: 0,
          adjusted_quantity_milli: 1000,
          internal_cost_total_minor: 0,
          purchase_status: 'not_needed',
          photo_asset_ids: [],
        },
      ],
      deposit_requested_minor: 0,
      amount_paid_minor: 2500,
      amount_refunded_minor: 500,
      amount_disputed_minor: 100,
      po_number: null,
      job_name: 'Job',
      customer_notes: null,
      private_notes: null,
      show_client_signature: false,
      show_company_signature: false,
      contract_template_id: null,
      contract_snapshot: null,
      client_snapshot: activeClient(),
      company_snapshot: { display_name: 'Co', logo_asset_id: null },
      settings_snapshot: {
        currency: 'usd',
        locale: 'en-US',
        timezone: 'America/New_York',
        payment_terms: null,
        footer: null,
      },
      service_address_snapshot: null,
      issue_date: null,
      expiration_date: null,
      due_date: null,
    };

    let capturedSet: Record<string, unknown> | undefined;
    const findOneAndUpdate = jest
      .fn()
      .mockImplementation(
        (_filter: unknown, update: { $set?: Record<string, unknown> }) => {
          capturedSet = update.$set;
          return {
            exec: jest.fn().mockResolvedValue({
              ...existing,
              ...update.$set,
              version: 2,
            }),
          };
        },
      );

    const service = createService({
      documentModel: {
        findOne: jest.fn().mockReturnValue({
          exec: jest.fn().mockResolvedValue(existing),
        }),
        findOneAndUpdate,
      },
      clientModel: {
        findOne: jest.fn().mockReturnValue({
          exec: jest.fn().mockResolvedValue(activeClient()),
        }),
      },
    });

    await service.update(
      String(existing._id),
      { version: 1, job_name: 'Updated job' },
      ORG_ID,
      ACTOR_ID,
    );

    expect(capturedSet).toBeDefined();
    expect(capturedSet).not.toHaveProperty('amount_paid_minor');
    expect(capturedSet).not.toHaveProperty('amount_refunded_minor');
    expect(capturedSet).not.toHaveProperty('amount_disputed_minor');
    // balance = 10000 - 2500 + 500 refunded + 100 disputed = 8100
    expect(capturedSet?.balance_due_minor).toBe(8100);
  });

  it('does not require vehicle_id anywhere on document create', async () => {
    let capturedCreatePayload: Record<string, unknown> | undefined;
    const create = jest
      .fn()
      .mockImplementation((payload: Record<string, unknown>) => {
        capturedCreatePayload = payload;
        return Promise.resolve({
          _id: new Types.ObjectId(),
          ...payload,
          created_at: new Date(),
          updated_at: new Date(),
          email_state: 'not_sent',
          sync_state: 'not_synced',
          online_payments_enabled: false,
          auto_generate_invoice_enabled: false,
          show_client_signature: false,
          show_company_signature: false,
          document_photo_asset_ids: [],
          attachment_asset_ids: [],
          version: 1,
        });
      });

    const service = createService({
      clientModel: {
        findOne: jest.fn().mockReturnValue({
          exec: jest.fn().mockResolvedValue(activeClient()),
        }),
      },
      documentModel: { create },
    });

    await service.create(
      {
        type: 'invoice',
        client_id: CLIENT_ID,
        line_items: [
          {
            sort_order: 0,
            line_type: 'labor',
            description: 'Install',
            rate_minor: 5000,
            quantity_milli: 2000,
          },
        ],
      },
      ORG_ID,
      ACTOR_ID,
    );

    expect(capturedCreatePayload?.vehicle_id).toBeUndefined();
    expect(capturedCreatePayload?.total_minor).toBe(10_000);
  });

  it('snapshots one-off service addresses and does not depend on later client address edits', async () => {
    let capturedCreatePayload: Record<string, unknown> | undefined;
    const serviceAddresses = [
      {
        street: '1 Original Rd',
        suite: null,
        city: 'Atlanta',
        state: 'GA',
        postal_code: '30301',
        country: 'US',
      },
    ];
    const client = activeClient({ service_addresses: serviceAddresses });

    const create = jest.fn().mockImplementation((payload) => {
      capturedCreatePayload = payload;
      return Promise.resolve({
        _id: new Types.ObjectId(),
        ...payload,
        created_at: new Date(),
        updated_at: new Date(),
      });
    });

    const service = createService({
      clientModel: {
        findOne: jest.fn().mockReturnValue({
          exec: jest.fn().mockResolvedValue(client),
        }),
      },
      documentModel: { create },
    });

    await service.create(
      {
        type: 'estimate',
        client_id: CLIENT_ID,
        job_name: 'Guest bath',
        service_address_snapshot: {
          street: '99 One Off Ln',
          suite: null,
          city: 'Decatur',
          state: 'GA',
          postal_code: '30030',
          country: 'US',
        },
        line_items: [
          {
            sort_order: 0,
            line_type: 'service',
            description: 'Work',
            rate_minor: 1000,
            quantity_milli: 1000,
          },
        ],
      },
      ORG_ID,
      ACTOR_ID,
    );

    serviceAddresses[0].street = 'Changed Client Rd';

    expect(capturedCreatePayload).toMatchObject({
      project_id: null,
      job_name: 'Guest bath',
      service_address_snapshot: {
        street: '99 One Off Ln',
        city: 'Decatur',
        state: 'GA',
      },
    });
  });

  it('preserves private notes and internal line fields when includeInternalFields is false', async () => {
    const lineId = new Types.ObjectId();
    let capturedSet: Record<string, unknown> | undefined;
    const existing = {
      _id: new Types.ObjectId(),
      organization_id: new Types.ObjectId(ORG_ID),
      type: 'estimate',
      client_id: new Types.ObjectId(CLIENT_ID),
      status: 'draft',
      version: 1,
      private_notes: 'keep me',
      service_address_snapshot: null,
      client_snapshot: {
        display_name: 'Pat',
        company_name: null,
        email: null,
        phone: null,
        billing_address: null,
        service_address: null,
      },
      company_snapshot: {},
      settings_snapshot: {},
      contract_template_id: null,
      contract_snapshot: null,
      show_client_signature: false,
      show_company_signature: false,
      customer_notes: null,
      po_number: null,
      job_name: null,
      issue_date: null,
      expiration_date: null,
      due_date: null,
      amount_paid_minor: 0,
      amount_refunded_minor: 0,
      amount_disputed_minor: 0,
      deposit_requested_minor: 0,
      line_items: [
        {
          _id: lineId,
          item_id: null,
          sort_order: 0,
          line_type: 'material',
          description: 'Paint',
          notes: null,
          unit_of_measure: 'gallon',
          sku_or_part_number: 'P-1',
          vendor_name: 'Sherwin',
          purchase_status: 'needed',
          internal_unit_cost_minor: 1200,
          waste_basis_points: 500,
          rate_minor: 2500,
          quantity_milli: 1000,
          adjusted_quantity_milli: 1050,
          internal_cost_total_minor: 1260,
          markup_type: 'none',
          markup_value: 0,
          markup_amount_minor: 0,
          discount_type: 'none',
          discount_value: 0,
          discount_amount_minor: 0,
          taxable: false,
          tax_id: null,
          tax_rate_basis_points: 0,
          tax_amount_minor: 0,
          subtotal_minor: 2500,
          total_minor: 2500,
          photo_asset_ids: [],
        },
      ],
    };

    const findOneAndUpdate = jest.fn().mockImplementation((_filter, update) => {
      capturedSet = update.$set;
      return {
        exec: jest.fn().mockResolvedValue({
          ...existing,
          ...update.$set,
          version: 2,
          created_at: new Date(),
          updated_at: new Date(),
        }),
      };
    });

    const service = createService({
      documentModel: {
        findOne: jest.fn().mockReturnValue({
          exec: jest.fn().mockResolvedValue(existing),
        }),
        findOneAndUpdate,
      },
      clientModel: {
        findOne: jest.fn().mockReturnValue({
          exec: jest.fn().mockResolvedValue(activeClient()),
        }),
      },
    });

    await service.update(
      String(existing._id),
      {
        version: 1,
        private_notes: null,
        line_items: [
          {
            id: String(lineId),
            sort_order: 0,
            line_type: 'material',
            description: 'Paint updated',
            rate_minor: 3000,
            quantity_milli: 1000,
            vendor_name: null,
            internal_unit_cost_minor: null,
            waste_basis_points: 0,
            purchase_status: 'not_needed',
          },
        ],
      },
      ORG_ID,
      ACTOR_ID,
      { includeInternalFields: false },
    );

    expect(capturedSet?.private_notes).toBe('keep me');
    const lines = capturedSet?.line_items as Array<Record<string, unknown>>;
    expect(lines[0]._id).toEqual(lineId);
    expect(lines[0].description).toBe('Paint updated');
    expect(lines[0].rate_minor).toBe(3000);
    expect(lines[0].vendor_name).toBe('Sherwin');
    expect(lines[0].internal_unit_cost_minor).toBe(1200);
    expect(lines[0].waste_basis_points).toBe(500);
    expect(lines[0].purchase_status).toBe('needed');
  });

  it('updates purchase status from plain line objects without clobbering totals', async () => {
    const lineId = new Types.ObjectId();
    let capturedSet: Record<string, unknown> | undefined;
    const existing = {
      _id: new Types.ObjectId(),
      organization_id: new Types.ObjectId(ORG_ID),
      type: 'estimate',
      status: 'draft',
      version: 2,
      total_minor: 5000,
      line_items: [
        {
          _id: lineId,
          description: 'Paint',
          purchase_status: 'needed',
          rate_minor: 2500,
          total_minor: 2500,
          toObject() {
            return {
              _id: lineId,
              description: 'Paint',
              purchase_status: 'needed',
              rate_minor: 2500,
              total_minor: 2500,
            };
          },
        },
      ],
    };

    const findOneAndUpdate = jest.fn().mockImplementation((_filter, update) => {
      capturedSet = update.$set;
      return {
        exec: jest.fn().mockResolvedValue({
          ...existing,
          line_items: update.$set.line_items,
          version: 3,
          created_at: new Date(),
          updated_at: new Date(),
          client_snapshot: {
            display_name: 'Pat',
            company_name: null,
            email: null,
            phone: null,
            billing_address: null,
            service_address: null,
          },
          company_snapshot: {},
          settings_snapshot: {},
        }),
      };
    });

    const service = createService({
      documentModel: {
        findOne: jest.fn().mockReturnValue({
          exec: jest.fn().mockResolvedValue(existing),
          select: jest.fn().mockReturnValue({
            exec: jest.fn().mockResolvedValue(null),
          }),
        }),
        findOneAndUpdate,
      },
    });

    await service.updateLinePurchaseStatuses(
      String(existing._id),
      2,
      [{ line_id: String(lineId), purchase_status: 'ordered' }],
      ORG_ID,
      ACTOR_ID,
    );

    const lines = capturedSet?.line_items as Array<Record<string, unknown>>;
    expect(lines[0]).toMatchObject({
      _id: lineId,
      description: 'Paint',
      purchase_status: 'ordered',
      total_minor: 2500,
    });
    expect(lines[0]).not.toHaveProperty('$__');
    expect(capturedSet).not.toHaveProperty('total_minor');
  });

  it('buildSnapshots uses company settings for company_snapshot and document defaults', async () => {
    const create = jest
      .fn()
      .mockImplementation((payload: Record<string, unknown>) =>
        Promise.resolve({
          _id: new Types.ObjectId(),
          ...payload,
          created_at: new Date(),
          updated_at: new Date(),
          version: 1,
          email_state: 'not_sent',
          sync_state: 'not_synced',
          online_payments_enabled: false,
          auto_generate_invoice_enabled: false,
          show_client_signature: false,
          show_company_signature: false,
          document_photo_asset_ids: [],
          attachment_asset_ids: [],
          amount_paid_minor: 0,
          amount_refunded_minor: 0,
          amount_disputed_minor: 0,
        }),
      );

    const getSnapshotSource = jest.fn().mockResolvedValue({
      business_timezone: 'America/Los_Angeles',
      account: {},
      company: {
        display_name: 'Acme Roofing',
        legal_name: 'Acme Roofing LLC',
        phone: '555-9999',
        email: 'hello@acme.test',
        website: 'https://acme.test',
        address: {
          street: '1 Main',
          suite: null,
          city: 'Austin',
          state: 'TX',
          postal_code: '78701',
          country: 'US',
        },
        license_number: 'LIC-42',
        logo_asset_id: null,
      },
      documents: {
        default_payment_terms: 'Due on receipt',
        default_invoice_due_days: 0,
        default_footer: 'Paid with thanks',
      },
      preferences: { currency: 'usd', locale: 'en-US' },
    });

    const service = createService({
      clientModel: {
        findOne: jest.fn().mockReturnValue({
          exec: jest.fn().mockResolvedValue(activeClient()),
        }),
      },
      documentModel: { create },
      settingsService: { getSnapshotSource },
    });

    const result = await service.create(
      {
        type: 'estimate',
        client_id: CLIENT_ID,
        line_items: [],
      } as never,
      ORG_ID,
      ACTOR_ID,
    );

    expect(getSnapshotSource).toHaveBeenCalledWith(ORG_ID);
    expect(result.company_snapshot).toMatchObject({
      display_name: 'Acme Roofing',
      legal_name: 'Acme Roofing LLC',
      phone: '555-9999',
      license_number: 'LIC-42',
    });
    expect(result.settings_snapshot).toMatchObject({
      timezone: 'America/Los_Angeles',
      payment_terms: 'Payment is due on receipt.',
      footer: null,
      currency: 'usd',
    });
  });

  it('create applies document settings defaults when payload omits them', async () => {
    let persisted: Record<string, unknown> | undefined;
    const create = jest
      .fn()
      .mockImplementation((payload: Record<string, unknown>) => {
        persisted = payload;
        return Promise.resolve({
          _id: new Types.ObjectId(),
          ...payload,
          email_state: 'not_sent',
          sync_state: 'not_synced',
          online_payments_enabled: false,
          amount_paid_minor: 0,
          amount_refunded_minor: 0,
          amount_disputed_minor: 0,
          version: 1,
          document_photo_asset_ids: [],
          attachment_asset_ids: [],
          created_at: new Date(),
          updated_at: new Date(),
        });
      });

    const issueDate = '2026-03-01T00:00:00.000Z';
    const getSnapshotSource = jest.fn().mockResolvedValue({
      business_timezone: 'America/New_York',
      account: {},
      company: {},
      documents: {
        default_estimate_expiration_days: 14,
        default_invoice_due_days: 21,
        default_deposit_basis_points: 2500,
        default_show_client_signature: true,
        default_show_company_signature: false,
        default_customer_notes: 'Thanks for choosing us',
      },
      preferences: { currency: 'usd', locale: 'en-US' },
    });

    const service = createService({
      clientModel: {
        findOne: jest.fn().mockReturnValue({
          exec: jest.fn().mockResolvedValue(activeClient()),
        }),
      },
      documentModel: { create },
      settingsService: { getSnapshotSource },
    });

    await service.create(
      {
        type: 'estimate',
        client_id: CLIENT_ID,
        issue_date: issueDate,
        line_items: [
          {
            sort_order: 0,
            line_type: 'service',
            description: 'Work',
            rate_minor: 10_000,
            quantity_milli: 1000,
            markup_type: 'none',
            markup_value: 0,
            discount_type: 'none',
            discount_value: 0,
            taxable: false,
          },
        ],
      },
      ORG_ID,
      ACTOR_ID,
    );

    expect(persisted?.expiration_date).toEqual(
      new Date('2026-03-15T00:00:00.000Z'),
    );
    expect(persisted?.deposit_requested_minor).toBe(2500);
    expect(persisted?.show_client_signature).toBe(true);
    expect(persisted?.show_company_signature).toBe(false);
    expect(persisted?.customer_notes).toBeNull();
    expect(persisted?.contract_snapshot).toBe('Default contract body');
  });
});
