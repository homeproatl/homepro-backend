import { ServiceUnavailableException } from '@nestjs/common';
import {
  renderInvoiceDocumentHtml,
  renderInvoiceEmailMessageHtml,
} from './invoice-template';
import { EstimateInvoiceService } from './estimate-invoice.service';

describe('EstimateInvoiceService', () => {
  function createService(overrides?: {
    estimateInvoiceSnapshotModel?: object;
    estimateInvoiceDispatchModel?: object;
    auditLogModel?: object;
    appSettingsModel?: object;
    configService?: object;
  }) {
    return new EstimateInvoiceService(
      {} as never,
      {} as never,
      {} as never,
      (overrides?.estimateInvoiceSnapshotModel ?? {}) as never,
      (overrides?.estimateInvoiceDispatchModel ?? {}) as never,
      (overrides?.appSettingsModel ?? {}) as never,
      (overrides?.auditLogModel ?? {}) as never,
      (overrides?.configService ?? {}) as never,
    );
  }

  function createInvoicePayload(overrides?: Record<string, unknown>) {
    return {
      estimate_id: 'estimate-1',
      customer_snapshot: {
        customer_id: 'customer-1',
        name: 'Rico Customer',
        email: 'customer@test.com',
        phone: '555-0100',
      },
      vehicle_snapshot: {
        vehicle_id: 'vehicle-1',
        label: '2003 HONDA Civic',
        vin: '2HGES165X3H619036',
        license_plate: 'FRD45FG',
        year: 2003,
        make: 'HONDA',
        model: 'Civic',
        mileage: 183368,
        mileage_out: 183368,
      },
      services_snapshot: [
        {
          name: 'Brake Service',
          note: null,
          labor_lines: [],
          part_lines: [],
          labor_total: 100,
          parts_total: 0,
          total: 100,
        },
      ],
      estimate_number_snapshot: 'EST-001',
      title_snapshot: 'Brake Service',
      time_zone_snapshot: 'America/New_York',
      complaint_or_request_snapshot: null,
      recommendation_snapshot: null,
      subtotal_snapshot: 100,
      tax_rate_snapshot: 8.875,
      tax_amount_snapshot: 8.88,
      total: 100,
      amount_paid_snapshot: 0,
      amount_remaining_snapshot: 100,
      payment_status_snapshot: 'UNPAID',
      payment_type_snapshot: 'POS_CARD',
      due_date_snapshot: null,
      scheduled_start_snapshot: null,
      scheduled_end_snapshot: null,
      generated_at: '2026-04-22T12:00:00.000Z',
      ...overrides,
    };
  }

  function createSnapshotDocument(overrides?: Record<string, unknown>) {
    const raw = {
      ...createInvoicePayload(),
      _id: 'snapshot-1',
      estimate_id: 'estimate-1',
      invoice_number: 'EST-001-R2',
      revision_number: 2,
      status: 'ISSUED',
      billable_hash: 'hash-1',
      issued_at: '2026-04-22T12:00:00.000Z',
      sent_at: null,
      stale_at: null,
      superseded_by_snapshot_id: null,
      created_at: '2026-04-22T12:00:00.000Z',
      updated_at: '2026-04-22T12:00:00.000Z',
      ...overrides,
    };

    const document = {
      ...raw,
      save: jest.fn().mockResolvedValue(undefined),
      toObject: () => ({
        ...raw,
        status: document.status,
        sent_at: document.sent_at,
        stale_at: document.stale_at,
        superseded_by_snapshot_id: document.superseded_by_snapshot_id,
      }),
    };

    return document;
  }

  function createDispatchDocument() {
    const raw = {
      _id: 'dispatch-1',
      estimate_id: 'estimate-1',
      invoice_snapshot_id: 'snapshot-1',
      recipient_email: 'customer@test.com',
      provider: 'resend',
      provider_message_id: null,
      provider_request_key: 'invoice:snapshot-1:request',
      delivery_status: 'PENDING',
      error_message: null,
      sent_at: null,
      created_at: '2026-04-22T12:00:00.000Z',
      updated_at: '2026-04-22T12:00:00.000Z',
    };

    return {
      ...raw,
      save: jest.fn().mockResolvedValue(undefined),
      toObject: () => raw,
    };
  }

  it('recomputes revision numbers when snapshot creation retries after a duplicate-key conflict', async () => {
    const findOne = jest
      .fn()
      .mockReturnValueOnce({
        sort: jest.fn().mockReturnValue({
          exec: jest.fn().mockResolvedValue({ revision_number: 3 }),
        }),
      })
      .mockReturnValueOnce({
        sort: jest.fn().mockReturnValue({
          exec: jest.fn().mockResolvedValue({ revision_number: 4 }),
        }),
      });

    const create = jest
      .fn()
      .mockRejectedValueOnce({ code: 11000 })
      .mockResolvedValueOnce({ id: 'snapshot-2' });

    const service = createService({
      estimateInvoiceSnapshotModel: {
        findOne,
        create,
      },
    });

    await (
      service as unknown as {
        createSnapshot: (aggregate: unknown) => Promise<void>;
      }
    ).createSnapshot({
      estimate: { _id: 'estimate-1' },
      payload: {
        customer_snapshot: {},
        vehicle_snapshot: {},
        services_snapshot: [],
        estimate_number_snapshot: 'EST-001',
        title_snapshot: 'Inspection',
        time_zone_snapshot: 'America/New_York',
        subtotal_snapshot: 100,
        tax_rate_snapshot: 8.875,
        tax_amount_snapshot: 8.88,
        total: 100,
        payment_status_snapshot: 'UNPAID',
        payment_type_snapshot: 'POS_CARD',
        due_date_snapshot: null,
        scheduled_start_snapshot: null,
        scheduled_end_snapshot: null,
      },
      billableHash: 'hash-1',
    });

    expect(create).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        invoice_number: 'EST-001-R4',
        revision_number: 4,
        subtotal_snapshot: 100,
        tax_rate_snapshot: 8.875,
        tax_amount_snapshot: 8.88,
      }),
    );
    expect(create).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        invoice_number: 'EST-001-R5',
        revision_number: 5,
        subtotal_snapshot: 100,
        tax_rate_snapshot: 8.875,
        tax_amount_snapshot: 8.88,
      }),
    );
  });

  it('uses the estimate number as the first issued invoice number', async () => {
    const findOne = jest.fn().mockReturnValue({
      sort: jest.fn().mockReturnValue({
        exec: jest.fn().mockResolvedValue(null),
      }),
    });
    const create = jest.fn().mockResolvedValue({ id: 'snapshot-1' });
    const service = createService({
      estimateInvoiceSnapshotModel: {
        findOne,
        create,
      },
    });

    await (
      service as unknown as {
        createSnapshot: (aggregate: unknown) => Promise<void>;
      }
    ).createSnapshot({
      estimate: { _id: 'estimate-1' },
      payload: {
        customer_snapshot: {},
        vehicle_snapshot: {},
        services_snapshot: [],
        estimate_number_snapshot: 'rbntpt',
        title_snapshot: 'Inspection',
        time_zone_snapshot: 'America/New_York',
        subtotal_snapshot: 100,
        tax_rate_snapshot: 8.875,
        tax_amount_snapshot: 8.88,
        total: 100,
        payment_status_snapshot: 'UNPAID',
        payment_type_snapshot: 'POS_CARD',
        due_date_snapshot: null,
        scheduled_start_snapshot: null,
        scheduled_end_snapshot: null,
      },
      billableHash: 'hash-1',
    });

    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        invoice_number: 'RBNTPT',
        revision_number: 1,
        subtotal_snapshot: 100,
        tax_rate_snapshot: 8.875,
        tax_amount_snapshot: 8.88,
      }),
    );
  });

  it('renders sent invoice PDFs from the issued snapshot number', async () => {
    const snapshot = createSnapshotDocument({
      invoice_number: 'EST-001-R2',
      revision_number: 2,
    });
    const dispatch = createDispatchDocument();
    const aggregate = {
      estimate: { _id: 'estimate-1' },
      customer: {
        email: 'customer@test.com',
        first_name: 'Rico',
        last_name: 'Customer',
      },
      vehicle: {},
      payload: createInvoicePayload({
        estimate_number_snapshot: 'EST-001',
      }),
      blockers: [],
      billableHash: 'hash-1',
    };
    const service = createService({
      estimateInvoiceDispatchModel: {
        create: jest.fn().mockResolvedValue(dispatch),
      },
    });
    const serviceInternals = service as unknown as {
      loadInvoiceAggregate: (estimateId: string) => Promise<unknown>;
      getGlobalInvoiceRuntimeReadiness: () => Promise<{
        pdfBlockers: string[];
        sendBlockers: string[];
      }>;
      resolveIssueableSnapshot: (
        aggregate: unknown,
        actorUserId?: string,
      ) => Promise<unknown>;
      getLatestDispatchForSnapshot: (snapshotId: unknown) => Promise<unknown>;
      getInvoiceProviderName: () => string;
      createInvoiceDispatchRequestKey: (snapshotId: unknown) => string;
      renderInvoicePdf: (invoice: unknown) => Promise<Uint8Array>;
      sendInvoiceEmail: (input: {
        invoiceNumber: string;
        pdfBytes: Uint8Array;
      }) => Promise<{ provider: string; providerMessageId: string }>;
      recordAudit: (input: unknown) => Promise<void>;
    };
    const renderInvoicePdf = jest
      .spyOn(serviceInternals, 'renderInvoicePdf')
      .mockResolvedValue(Uint8Array.of(1, 2, 3));
    const sendInvoiceEmail = jest
      .spyOn(serviceInternals, 'sendInvoiceEmail')
      .mockResolvedValue({
        provider: 'resend',
        providerMessageId: 'message-1',
      });

    jest
      .spyOn(serviceInternals, 'loadInvoiceAggregate')
      .mockResolvedValue(aggregate);
    jest
      .spyOn(serviceInternals, 'getGlobalInvoiceRuntimeReadiness')
      .mockResolvedValue({ pdfBlockers: [], sendBlockers: [] });
    jest
      .spyOn(serviceInternals, 'resolveIssueableSnapshot')
      .mockResolvedValue(snapshot);
    jest
      .spyOn(serviceInternals, 'getLatestDispatchForSnapshot')
      .mockResolvedValue(null);
    jest
      .spyOn(serviceInternals, 'getInvoiceProviderName')
      .mockReturnValue('resend');
    jest
      .spyOn(serviceInternals, 'createInvoiceDispatchRequestKey')
      .mockReturnValue('invoice:snapshot-1:request');
    jest.spyOn(serviceInternals, 'recordAudit').mockResolvedValue(undefined);

    await service.sendInvoice('estimate-1', 'user-1');

    expect(renderInvoicePdf).toHaveBeenCalledWith(
      expect.objectContaining({
        invoice_number: 'EST-001-R2',
        estimate_number_snapshot: 'EST-001',
      }),
    );
    expect(sendInvoiceEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        invoiceNumber: 'EST-001-R2',
        pdfBytes: Uint8Array.of(1, 2, 3),
      }),
    );
  });

  it('issues a tracked snapshot before rendering printable invoice PDFs', async () => {
    const snapshot = createSnapshotDocument({ invoice_number: 'EST-001' });
    const aggregate = {
      estimate: { _id: 'estimate-1', estimate_number: 'EST-001' },
      customer: { email: null },
      vehicle: {},
      payload: createInvoicePayload(),
      blockers: [
        'Customer email is required before an invoice can be issued or sent.',
      ],
      billableHash: 'hash-1',
    };
    const service = createService();
    const serviceInternals = service as unknown as {
      loadInvoiceAggregate: (estimateId: string) => Promise<unknown>;
      getGlobalInvoiceRuntimeReadiness: () => Promise<{
        pdfBlockers: string[];
        sendBlockers: string[];
      }>;
      resolveIssueableSnapshot: (
        aggregate: unknown,
        actorUserId: string | undefined,
        options: { blockers: string[] },
      ) => Promise<unknown>;
      renderInvoicePdf: (invoice: unknown) => Promise<Uint8Array>;
    };
    const resolveIssueableSnapshot = jest
      .spyOn(serviceInternals, 'resolveIssueableSnapshot')
      .mockResolvedValue(snapshot);
    const renderInvoicePdf = jest
      .spyOn(serviceInternals, 'renderInvoicePdf')
      .mockResolvedValue(Uint8Array.of(4, 5, 6));

    jest
      .spyOn(serviceInternals, 'loadInvoiceAggregate')
      .mockResolvedValue(aggregate);
    jest
      .spyOn(serviceInternals, 'getGlobalInvoiceRuntimeReadiness')
      .mockResolvedValue({ pdfBlockers: [], sendBlockers: [] });

    const result = await service.getInvoicePdf('estimate-1');

    expect(resolveIssueableSnapshot).toHaveBeenCalledWith(aggregate, undefined, {
      blockers: [],
    });
    expect(renderInvoicePdf).toHaveBeenCalledWith(
      expect.objectContaining({
        invoice_number: 'EST-001',
      }),
    );
    expect(result.fileName).toBe('EST-001.pdf');
    expect(result.buffer).toEqual(Buffer.from(Uint8Array.of(4, 5, 6)));
  });

  it('reissues snapshots when stored tax fields drift from the current invoice payload', async () => {
    const latestSnapshot = createSnapshotDocument({
      invoice_number: 'EST-001',
      revision_number: 1,
      billable_hash: 'hash-1',
      subtotal_snapshot: 100,
      tax_rate_snapshot: 8.875,
      tax_amount_snapshot: 0,
      total: 100,
      amount_paid_snapshot: 0,
      amount_remaining_snapshot: 100,
    });
    const newSnapshot = createSnapshotDocument({
      _id: 'snapshot-2',
      invoice_number: 'EST-001-R2',
      revision_number: 2,
      billable_hash: 'hash-1',
      subtotal_snapshot: 100,
      tax_rate_snapshot: 8.875,
      tax_amount_snapshot: 8.88,
      total: 100,
      amount_paid_snapshot: 0,
      amount_remaining_snapshot: 100,
    });
    const findOne = jest
      .fn()
      .mockReturnValueOnce({
        sort: jest.fn().mockReturnValue({
          exec: jest.fn().mockResolvedValue(latestSnapshot),
        }),
      })
      .mockReturnValueOnce({
        sort: jest.fn().mockReturnValue({
          exec: jest.fn().mockResolvedValue(latestSnapshot),
        }),
      });
    const create = jest.fn().mockResolvedValue(newSnapshot);
    const recordAudit = jest.fn().mockResolvedValue(undefined);
    const service = createService({
      estimateInvoiceSnapshotModel: {
        findOne,
        create,
      },
      auditLogModel: {
        create: recordAudit,
      },
    });

    const result = await (
      service as unknown as {
        resolveIssueableSnapshot: (aggregate: unknown) => Promise<unknown>;
      }
    ).resolveIssueableSnapshot({
      estimate: { _id: 'estimate-1' },
      payload: createInvoicePayload(),
      blockers: [],
      billableHash: 'hash-1',
    });

    expect(latestSnapshot.status).toBe('STALE');
    expect(latestSnapshot.save).toHaveBeenCalledTimes(2);
    expect(latestSnapshot.superseded_by_snapshot_id).toBe('snapshot-2');
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        invoice_number: 'EST-001-R2',
        revision_number: 2,
        tax_rate_snapshot: 8.875,
        tax_amount_snapshot: 8.88,
        total: 100,
      }),
    );
    expect(result).toBe(newSnapshot);
  });

  it('does not treat LOG transport as a successful email delivery', () => {
    const service = createService({
      configService: {
        get: jest.fn((key: string) => {
          if (key === 'INVOICE_EMAIL_TRANSPORT') {
            return 'LOG';
          }

          if (key === 'INVOICE_EMAIL_FROM') {
            return 'billing@rico.local';
          }

          return undefined;
        }),
      },
    });

    expect(() =>
      (
        service as unknown as {
          sendInvoiceEmail: (input: {
            invoiceNumber: string;
            recipientEmail: string;
            html: string;
            text: string;
            pdfBytes: Uint8Array;
            idempotencyKey: string;
          }) => Promise<void>;
        }
      ).sendInvoiceEmail({
        invoiceNumber: 'INV-123456',
        recipientEmail: 'customer@test.com',
        html: '<html></html>',
        text: 'Invoice text',
        pdfBytes: Uint8Array.of(1, 2, 3),
        idempotencyKey: 'invoice:inv-1:retry-1',
      }),
    ).toThrow(ServiceUnavailableException);
  });

  it('uses RESEND transport for real invoice delivery when configured', async () => {
    const service = createService({
      configService: {
        get: jest.fn((key: string) => {
          if (key === 'INVOICE_EMAIL_TRANSPORT') {
            return 'RESEND';
          }

          if (key === 'INVOICE_EMAIL_FROM') {
            return 'Gmb Workshop <billing@gmbworkshop.shop>';
          }

          if (key === 'INVOICE_EMAIL_RESEND_API_KEY') {
            return 're_test_123';
          }

          return undefined;
        }),
      },
    });
    const send = jest.fn().mockResolvedValue({
      data: { id: 'resend-message-1' },
      error: null,
    });

    jest
      .spyOn(
        service as unknown as {
          getResendClient: () => { emails: { send: typeof send } };
        },
        'getResendClient',
      )
      .mockReturnValue({ emails: { send } });

    await expect(
      (
        service as unknown as {
          sendInvoiceEmail: (input: {
            invoiceNumber: string;
            recipientEmail: string;
            html: string;
            text: string;
            pdfBytes: Uint8Array;
            idempotencyKey: string;
          }) => Promise<{ provider: string; providerMessageId: string }>;
        }
      ).sendInvoiceEmail({
        invoiceNumber: 'INV-123456',
        recipientEmail: 'customer@test.com',
        html: '<html><body>Invoice Attached</body></html>',
        text: 'Invoice text',
        pdfBytes: Uint8Array.of(1, 2, 3),
        idempotencyKey: 'invoice:inv-1:retry-1',
      }),
    ).resolves.toEqual({
      provider: 'resend',
      providerMessageId: 'resend-message-1',
    });

    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({
        from: 'Gmb Workshop <billing@gmbworkshop.shop>',
        to: ['customer@test.com'],
      }),
      expect.objectContaining({
        idempotencyKey: 'invoice:inv-1:retry-1',
      }),
    );
  });

  it('renders grouped invoice email content', () => {
    const html = renderInvoiceEmailMessageHtml({
      invoiceNumber: 'INV-123456',
      customerName: 'Rico Customer',
      estimateNumber: 'EST-001',
      total: 150,
      dueDate: '2026-03-29T00:00:00.000Z',
      timeZone: 'America/New_York',
    });

    expect(html).toContain('Invoice INV-123456');
    expect(html).toContain('Amount due');
  });

  it('uses the estimate number instead of a Preview placeholder for live invoice previews', () => {
    const service = createService();

    expect(
      (
        service as unknown as {
          getInvoiceDocumentLabel: (input: {
            estimate_number_snapshot: string;
          }) => string;
        }
      ).getInvoiceDocumentLabel({
        estimate_number_snapshot: 'RBNTPT',
      }),
    ).toBe('RBNTPT');
  });

  it('renders invoice pdf html with document metadata, line item table, and totals summary', () => {
    const html = renderInvoiceDocumentHtml({
      invoiceNumber: 'INV-123456',
      estimateNumber: 'EST-001',
      title: 'Brake Service',
      timeZone: 'America/New_York',
      customerComment: 'Customer hears grinding when braking.',
      recommendation: 'Replace front brake pads.',
      customerName: 'Rico Customer',
      customerEmail: 'customer@test.com',
      customerPhone: '555-0100',
      vehicleLabel: 'FRD45FG · Honda Civic',
      vehicleVin: '2HGES165X3H619036',
      vehiclePlate: 'FRD45FG',
      vehicleYear: 2003,
      vehicleMake: 'Honda',
      vehicleModel: 'Civic',
      vehicleMileage: 183368,
      vehicleMileageOut: 183500,
      dueDate: '2026-03-29T00:00:00.000Z',
      generatedAt: '2026-03-25T00:00:00.000Z',
      paymentStatus: 'UNPAID',
      paymentType: 'POS_CARD',
      subTotal: 135,
      taxRate: 8.875,
      taxAmount: 11.98,
      total: 135,
      amountPaid: 0,
      amountRemaining: 135,
      services: [
        {
          name: 'Brake Service',
          note: 'Front brake service',
          laborTotal: 100,
          partsTotal: 35,
          total: 135,
          laborLines: [
            {
              description: 'Brake labor',
              hours: 1,
              rate: 100,
              subTotal: 100,
            },
          ],
          partLines: [
            {
              description: 'Brake pads',
              partNumber: 'BP-100',
              quantity: 1,
              price: 35,
              subTotal: 35,
            },
          ],
        },
      ],
      mode: 'issued',
    });

    expect(html).toContain('Invoice');
    expect(html).toContain('GMB Auto');
    expect(html).toContain('class="invoice-logo"');
    expect(html).toContain('align-items: center;');
    expect(html).toContain(
      'width:250px;max-width:100%;height:auto;object-fit:contain;',
    );
    expect(html).not.toContain('invoice-logo-box');
    expect(html).not.toContain('background:#f8fafc;padding:7px 10px');
    expect(html).toContain('301 Elmont Rd');
    expect(html).toContain('Elmont, NY 11003');
    expect(html).toContain('(646) 807-6937');
    expect(html).toContain('gmb.auto@yahoo.com');
    expect(html).toContain('Invoice #INV-123456');
    expect(html).toContain('Created: 03/24/2026');
    expect(html).toContain('Invoiced: 03/24/2026');
    expect(html).toContain('Payment Term: On Receipt');
    expect(html).toContain('Payment Due: 03/29/2026');
    expect(html).not.toContain('Payment Due: 03/28/2026');
    expect(html).toContain('Service Writer: M Rico');
    expect(html).not.toContain('Document No.');
    expect(html).toContain('2003 HONDA Civic');
    expect(html).toContain('VIN: 2HGES165X3H619036');
    expect(html).toContain('Mileage In: 183,368 mi');
    expect(html).toContain('Mileage Out: 183,500 mi');
    expect(html).toContain('CUSTOMER COMMENT');
    expect(html).toContain('Customer hears grinding when braking.');
    expect(html).toContain('RECOMMENDATION');
    expect(html).toContain('Replace front brake pads.');
    expect(html).toContain('RATE / HR');
    expect(html).toContain('PART USED');
    expect(html).toContain('Labor subtotal');
    expect(html).toContain('Parts subtotal');
    expect(html).toContain('Tax (8.875%)');
    expect(html).toContain('$11.98');
    expect(html).toContain('Total due');
    expect(html).toContain('$146.98');
    expect(html).toContain('Brake Service');
    expect(html).toContain('Brake labor');
    expect(html).toContain(
      'border-collapse:collapse;border:1px solid #cbd5e1;table-layout:fixed;',
    );
    expect(html).toContain(
      'font-weight:700;color:#111827;background:#f3f4f6;text-transform:uppercase;letter-spacing:0.07em;',
    );
    expect(html).toContain('box-sizing: border-box;');
    expect(html).toContain('print-color-adjust: exact;');
    expect(html).toContain('@media print');
    expect(html).toContain('padding: 10px !important;');
    expect(html).toContain('M Rico');
  });

  it('omits customer comment and recommendation sections when invoice notes are empty', () => {
    const html = renderInvoiceDocumentHtml({
      invoiceNumber: 'INV-000111',
      estimateNumber: 'EST-EMPTY-NOTES',
      title: 'Oil Service',
      timeZone: 'America/New_York',
      customerComment: '   ',
      recommendation: '—',
      customerName: 'Rico Customer',
      customerEmail: 'customer@test.com',
      customerPhone: '555-0100',
      vehicleLabel: 'FRD45FG · Honda Civic',
      vehicleVin: '2HGES165X3H619036',
      vehiclePlate: 'FRD45FG',
      vehicleYear: 2003,
      vehicleMake: 'Honda',
      vehicleModel: 'Civic',
      vehicleMileage: 183368,
      vehicleMileageOut: 183500,
      dueDate: '2026-03-29T00:00:00.000Z',
      generatedAt: '2026-03-25T00:00:00.000Z',
      paymentStatus: 'UNPAID',
      paymentType: 'POS_CARD',
      subTotal: 100,
      taxRate: 0,
      taxAmount: 0,
      total: 100,
      amountPaid: 0,
      amountRemaining: 100,
      services: [
        {
          name: 'Oil Service',
          note: null,
          laborTotal: 100,
          partsTotal: 0,
          total: 100,
          laborLines: [
            {
              description: 'Oil change labor',
              hours: 1,
              rate: 100,
              subTotal: 100,
            },
          ],
          partLines: [],
        },
      ],
      mode: 'preview',
    });

    expect(html).not.toContain('CUSTOMER COMMENT');
    expect(html).not.toContain('RECOMMENDATION');
  });

  it('renders a paid amount row for part-paid invoices so the remaining balance is visually explained', () => {
    const html = renderInvoiceDocumentHtml({
      invoiceNumber: 'INV-654321',
      estimateNumber: 'EST-002',
      title: 'Suspension Service',
      timeZone: 'America/New_York',
      customerComment: null,
      recommendation: null,
      customerName: 'Rico Customer',
      customerEmail: 'customer@test.com',
      customerPhone: '555-0100',
      vehicleLabel: 'XYZ-789 · Honda Accord',
      vehicleVin: 'VIN-789',
      vehiclePlate: 'XYZ-789',
      vehicleYear: 2023,
      vehicleMake: 'Honda',
      vehicleModel: 'Accord',
      vehicleMileage: 50000,
      vehicleMileageOut: 50000,
      dueDate: '2026-03-29T00:00:00.000Z',
      generatedAt: '2026-03-25T00:00:00.000Z',
      paymentStatus: 'PART_PAID',
      paymentType: 'POS_CARD',
      subTotal: 460,
      taxRate: 0,
      taxAmount: 0,
      total: 460,
      amountPaid: 230,
      amountRemaining: 230,
      services: [
        {
          name: 'Suspension Service',
          note: 'Front suspension work',
          laborTotal: 260,
          partsTotal: 200,
          total: 460,
          laborLines: [
            {
              description: 'Suspension labor',
              hours: 2,
              rate: 130,
              subTotal: 260,
            },
          ],
          partLines: [
            {
              description: 'Control arm',
              partNumber: 'CA-200',
              quantity: 1,
              price: 200,
              subTotal: 200,
            },
          ],
        },
      ],
      mode: 'issued',
    });

    expect(html).toContain('Labor subtotal');
    expect(html).toContain('$260.00');
    expect(html).toContain('Parts subtotal');
    expect(html).toContain('$200.00');
    expect(html).toContain('Subtotal');
    expect(html).not.toContain('Tax');
    expect(html).toContain('Part paid');
    expect(html).toContain('-$230.00');
    expect(html).toContain('Total due');
    expect(html).toContain('$230.00');
  });

  it('renders tax as part of the remaining invoice balance', () => {
    const html = renderInvoiceDocumentHtml({
      invoiceNumber: 'INV-654322',
      estimateNumber: 'EST-002B',
      title: 'Suspension Service',
      timeZone: 'America/New_York',
      customerComment: null,
      recommendation: null,
      customerName: 'Rico Customer',
      customerEmail: 'customer@test.com',
      customerPhone: '555-0100',
      vehicleLabel: 'XYZ-789 · Honda Accord',
      vehicleVin: 'VIN-789',
      vehiclePlate: 'XYZ-789',
      vehicleYear: 2023,
      vehicleMake: 'Honda',
      vehicleModel: 'Accord',
      vehicleMileage: 50000,
      vehicleMileageOut: 50000,
      dueDate: '2026-03-29T00:00:00.000Z',
      generatedAt: '2026-03-25T00:00:00.000Z',
      paymentStatus: 'PART_PAID',
      paymentType: 'POS_CARD',
      subTotal: 460,
      taxRate: 8.875,
      taxAmount: 40.83,
      total: 460,
      amountPaid: 460,
      amountRemaining: 0,
      services: [
        {
          name: 'Suspension Service',
          note: 'Front suspension work',
          laborTotal: 260,
          partsTotal: 200,
          total: 460,
          laborLines: [
            {
              description: 'Suspension labor',
              hours: 2,
              rate: 130,
              subTotal: 260,
            },
          ],
          partLines: [
            {
              description: 'Control arm',
              partNumber: 'CA-200',
              quantity: 1,
              price: 200,
              subTotal: 200,
            },
          ],
        },
      ],
      mode: 'issued',
    });

    expect(html).toContain('Subtotal');
    expect(html).toContain('$460.00');
    expect(html).toContain('Tax (8.875%)');
    expect(html).toContain('$40.83');
    expect(html).toContain('Part paid');
    expect(html).toContain('-$460.00');
    expect(html).toContain('Total due');
    expect(html).toContain('$40.83');
  });

  it('adds preserved tax to total due when the stored estimate total equals the subtotal', () => {
    const html = renderInvoiceDocumentHtml({
      invoiceNumber: 'INV-654323',
      estimateNumber: 'EST-002C',
      title: 'General Service',
      timeZone: 'America/New_York',
      customerComment: null,
      recommendation: null,
      customerName: 'Rico Customer',
      customerEmail: 'customer@test.com',
      customerPhone: '555-0100',
      vehicleLabel: 'ABC-123 · BMW X5',
      vehicleVin: 'VIN-123',
      vehiclePlate: 'ABC-123',
      vehicleYear: 2015,
      vehicleMake: 'BMW',
      vehicleModel: 'X5',
      vehicleMileage: 72000,
      vehicleMileageOut: 72000,
      dueDate: '2026-03-29T00:00:00.000Z',
      generatedAt: '2026-03-25T00:00:00.000Z',
      paymentStatus: 'PAID',
      paymentType: 'POS_CARD',
      subTotal: 460,
      taxRate: 8.875,
      taxAmount: 40.83,
      total: 460,
      amountPaid: 460,
      amountRemaining: 0,
      services: [
        {
          name: 'General Service',
          note: null,
          laborTotal: 260,
          partsTotal: 200,
          total: 460,
          laborLines: [
            {
              description: 'General labor',
              hours: 2,
              rate: 130,
              subTotal: 260,
            },
          ],
          partLines: [
            {
              description: 'General part',
              partNumber: 'GP-200',
              quantity: 1,
              price: 200,
              subTotal: 200,
            },
          ],
        },
      ],
      mode: 'issued',
    });

    expect(html).toContain('Subtotal');
    expect(html).toContain('$460.00');
    expect(html).toContain('Tax (8.875%)');
    expect(html).toContain('$40.83');
    expect(html).toContain('Amount paid');
    expect(html).toContain('-$460.00');
    expect(html).toContain('Total due');
    expect(html).toContain('$40.83');
  });

  it('preserves recorded overpayments on invoices while recomputing the remaining balance from job total billing', () => {
    const html = renderInvoiceDocumentHtml({
      invoiceNumber: 'INV-654324',
      estimateNumber: 'EST-002D',
      title: 'General Service',
      timeZone: 'America/New_York',
      customerComment: null,
      recommendation: null,
      customerName: 'Rico Customer',
      customerEmail: 'customer@test.com',
      customerPhone: '555-0100',
      vehicleLabel: 'ABC-123 · BMW X5',
      vehicleVin: 'VIN-123',
      vehiclePlate: 'ABC-123',
      vehicleYear: 2015,
      vehicleMake: 'BMW',
      vehicleModel: 'X5',
      vehicleMileage: 72000,
      vehicleMileageOut: 72000,
      dueDate: '2026-03-29T00:00:00.000Z',
      generatedAt: '2026-03-25T00:00:00.000Z',
      paymentStatus: 'PAID',
      paymentType: 'POS_CARD',
      subTotal: 460,
      taxRate: 8.875,
      taxAmount: 40.83,
      total: 460,
      amountPaid: 500.83,
      amountRemaining: 0,
      services: [
        {
          name: 'General Service',
          note: null,
          laborTotal: 260,
          partsTotal: 200,
          total: 460,
          laborLines: [
            {
              description: 'General labor',
              hours: 2,
              rate: 130,
              subTotal: 260,
            },
          ],
          partLines: [
            {
              description: 'General part',
              partNumber: 'GP-200',
              quantity: 1,
              price: 200,
              subTotal: 200,
            },
          ],
        },
      ],
      mode: 'issued',
    });

    expect(html).toContain('Amount paid');
    expect(html).toContain('-$500.83');
    expect(html).toContain('Total due');
    expect(html).toContain('$0.00');
  });

  it('derives total due from total minus amount paid when a snapshot carries a stale remaining balance', () => {
    const html = renderInvoiceDocumentHtml({
      invoiceNumber: 'INV-777777',
      estimateNumber: 'EST-003',
      title: 'Engine Service',
      timeZone: 'America/New_York',
      customerComment: null,
      recommendation: null,
      customerName: 'Rico Customer',
      customerEmail: 'customer@test.com',
      customerPhone: '555-0100',
      vehicleLabel: 'RST-456 · Ford Fusion',
      vehicleVin: 'VIN-456',
      vehiclePlate: 'RST-456',
      vehicleYear: 2020,
      vehicleMake: 'Ford',
      vehicleModel: 'Fusion',
      vehicleMileage: 64000,
      vehicleMileageOut: 64000,
      dueDate: '2026-03-29T00:00:00.000Z',
      generatedAt: '2026-03-25T00:00:00.000Z',
      paymentStatus: 'PART_PAID',
      paymentType: 'POS_CARD',
      subTotal: 460,
      taxRate: 0,
      taxAmount: 0,
      total: 460,
      amountPaid: 230,
      amountRemaining: 999,
      services: [
        {
          name: 'Engine Service',
          note: 'Tune-up and parts',
          laborTotal: 260,
          partsTotal: 200,
          total: 460,
          laborLines: [
            {
              description: 'Engine labor',
              hours: 2,
              rate: 130,
              subTotal: 260,
            },
          ],
          partLines: [
            {
              description: 'Spark plugs',
              partNumber: 'SP-400',
              quantity: 1,
              price: 200,
              subTotal: 200,
            },
          ],
        },
      ],
      mode: 'issued',
    });

    expect(html).toContain('Part paid');
    expect(html).toContain('-$230.00');
    expect(html).toContain('Total due');
    expect(html).toContain('$230.00');
    expect(html).not.toContain('$999.00');
  });

  it('serializes invoice snapshots without leaking raw Mongo fields', () => {
    const service = createService();

    const result = (
      service as unknown as {
        serializeSnapshot: (snapshot: {
          toObject: () => Record<string, unknown>;
        }) => Record<string, unknown>;
      }
    ).serializeSnapshot({
      toObject: () => ({
        _id: 'snapshot-1',
        __v: 0,
        estimate_id: 'estimate-1',
        invoice_number: 'INV-100',
        revision_number: 2,
        status: 'ISSUED',
        customer_snapshot: {
          customer_id: 'customer-1',
          name: 'Rico Customer',
          email: 'customer@example.com',
          phone: '123',
        },
        vehicle_snapshot: {
          vehicle_id: 'vehicle-1',
          label: '2020 Honda Accord',
          vin: 'VIN123',
          license_plate: 'ABC123',
        },
        services_snapshot: [],
        estimate_number_snapshot: 'EST-100',
        title_snapshot: 'Brake Estimate',
        time_zone_snapshot: 'America/New_York',
        total: 250,
        payment_status_snapshot: 'UNPAID',
        payment_type_snapshot: 'POS_CARD',
        due_date_snapshot: null,
        scheduled_start_snapshot: null,
        scheduled_end_snapshot: null,
        billable_hash: 'hash-1',
        issued_at: '2026-04-03T08:00:00.000Z',
        sent_at: null,
        stale_at: null,
        superseded_by_snapshot_id: null,
        created_at: '2026-04-03T08:00:00.000Z',
        updated_at: '2026-04-03T08:05:00.000Z',
      }),
    });

    expect(result).toMatchObject({
      id: 'snapshot-1',
      estimate_id: 'estimate-1',
      invoice_number: 'INV-100',
      revision_number: 2,
      status: 'ISSUED',
      billable_hash: 'hash-1',
    });
    expect(result).not.toHaveProperty('_id');
    expect(result).not.toHaveProperty('__v');
  });

  it('serializes invoice snapshots with recomputed remaining balances while preserving recorded overpayments', () => {
    const service = createService();

    const result = (
      service as unknown as {
        serializeSnapshot: (snapshot: {
          toObject: () => Record<string, unknown>;
        }) => Record<string, unknown>;
      }
    ).serializeSnapshot({
      toObject: () => ({
        _id: 'snapshot-legacy-1',
        estimate_id: 'estimate-1',
        invoice_number: 'INV-101',
        revision_number: 3,
        status: 'SENT',
        customer_snapshot: {
          customer_id: 'customer-1',
          name: 'Rico Customer',
          email: 'customer@example.com',
          phone: '123',
        },
        vehicle_snapshot: {
          vehicle_id: 'vehicle-1',
          label: '2020 Honda Accord',
          vin: 'VIN123',
          license_plate: 'ABC123',
        },
        services_snapshot: [
          {
            estimate_service_id: 'service-1',
            canned_service_id: null,
            name: 'Legacy Service',
            labor_lines: [],
            part_lines: [],
            labor_total: 260,
            parts_total: 200,
            total: 460,
          },
        ],
        estimate_number_snapshot: 'EST-101',
        title_snapshot: 'Legacy Paid Invoice',
        time_zone_snapshot: 'America/New_York',
        subtotal_snapshot: 460,
        tax_rate_snapshot: 8.875,
        tax_amount_snapshot: 40.83,
        total: 500.83,
        amount_paid_snapshot: 500.83,
        amount_remaining_snapshot: 40.83,
        payment_status_snapshot: 'PAID',
        payment_type_snapshot: 'POS_CARD',
        due_date_snapshot: null,
        scheduled_start_snapshot: null,
        scheduled_end_snapshot: null,
        billable_hash: 'hash-legacy-1',
        issued_at: '2026-04-03T08:00:00.000Z',
        sent_at: '2026-04-03T08:05:00.000Z',
        stale_at: null,
        superseded_by_snapshot_id: null,
        created_at: '2026-04-03T08:00:00.000Z',
        updated_at: '2026-04-03T08:05:00.000Z',
      }),
    });

    expect(result).toMatchObject({
      total: 500.83,
      amount_paid_snapshot: 500.83,
      amount_remaining_snapshot: 0,
      payment_status_snapshot: 'PAID',
    });
  });

  it('serializes stale paid invoice snapshots as part paid when tax leaves a balance', () => {
    const service = createService();

    const result = (
      service as unknown as {
        serializeSnapshot: (snapshot: {
          toObject: () => Record<string, unknown>;
        }) => Record<string, unknown>;
      }
    ).serializeSnapshot({
      toObject: () => ({
        _id: 'snapshot-legacy-2',
        estimate_id: 'estimate-1',
        invoice_number: 'INV-102',
        revision_number: 4,
        status: 'SENT',
        customer_snapshot: {
          customer_id: 'customer-1',
          name: 'Rico Customer',
          email: 'customer@example.com',
          phone: '123',
        },
        vehicle_snapshot: {
          vehicle_id: 'vehicle-1',
          label: '2020 Honda Accord',
          vin: 'VIN123',
          license_plate: 'ABC123',
        },
        services_snapshot: [
          {
            estimate_service_id: 'service-1',
            canned_service_id: null,
            name: 'Legacy Service',
            labor_lines: [],
            part_lines: [],
            labor_total: 260,
            parts_total: 200,
            total: 460,
          },
        ],
        estimate_number_snapshot: 'EST-102',
        title_snapshot: 'Legacy Paid Without Tax',
        time_zone_snapshot: 'America/New_York',
        subtotal_snapshot: 460,
        tax_rate_snapshot: 8.875,
        tax_amount_snapshot: 40.83,
        total: 460,
        amount_paid_snapshot: 460,
        amount_remaining_snapshot: 0,
        payment_status_snapshot: 'PAID',
        payment_type_snapshot: 'POS_CARD',
        due_date_snapshot: null,
        scheduled_start_snapshot: null,
        scheduled_end_snapshot: null,
        billable_hash: 'hash-legacy-2',
        issued_at: '2026-04-03T08:00:00.000Z',
        sent_at: '2026-04-03T08:05:00.000Z',
        stale_at: null,
        superseded_by_snapshot_id: null,
        created_at: '2026-04-03T08:00:00.000Z',
        updated_at: '2026-04-03T08:05:00.000Z',
      }),
    });

    expect(result).toMatchObject({
      total: 500.83,
      amount_paid_snapshot: 460,
      amount_remaining_snapshot: 40.83,
      payment_status_snapshot: 'PART_PAID',
    });
  });

  it('serializes invoice snapshot part numbers', () => {
    const service = createService();

    const result = (
      service as unknown as {
        serializeSnapshot: (snapshot: {
          toObject: () => Record<string, unknown>;
        }) => Record<string, unknown>;
      }
    ).serializeSnapshot({
      toObject: () => ({
        _id: 'snapshot-1',
        estimate_id: 'estimate-1',
        invoice_number: 'INV-100',
        revision_number: 2,
        status: 'ISSUED',
        customer_snapshot: {
          customer_id: 'customer-1',
          name: 'Rico Customer',
          email: 'customer@example.com',
          phone: '123',
        },
        vehicle_snapshot: {
          vehicle_id: 'vehicle-1',
          label: '2020 Honda Accord',
          vin: 'VIN123',
          license_plate: 'ABC123',
        },
        services_snapshot: [
          {
            estimate_service_id: 'service-1',
            canned_service_id: null,
            name: 'Brake Service',
            labor_lines: [],
            part_lines: [
              {
                name: 'Brake pads',
                part_number: 'BP-100',
                quantity: 1,
                cost: 50,
                price: 80,
                discount_percent: 0,
                subtotal: 80,
              },
            ],
            labor_total: 0,
            parts_total: 80,
            total: 80,
          },
        ],
        estimate_number_snapshot: 'EST-100',
        title_snapshot: 'Brake Estimate',
        time_zone_snapshot: 'America/New_York',
        total: 80,
        payment_status_snapshot: 'UNPAID',
        payment_type_snapshot: 'POS_CARD',
        due_date_snapshot: null,
        scheduled_start_snapshot: null,
        scheduled_end_snapshot: null,
        billable_hash: 'hash-1',
        issued_at: '2026-04-03T08:00:00.000Z',
        sent_at: null,
        stale_at: null,
        superseded_by_snapshot_id: null,
        created_at: '2026-04-03T08:00:00.000Z',
        updated_at: '2026-04-03T08:05:00.000Z',
      }),
    });

    expect(result).toMatchObject({
      services_snapshot: [
        expect.objectContaining({
          part_lines: [
            expect.objectContaining({
              part_number: 'BP-100',
            }),
          ],
        }),
      ],
    });
  });

  it('serializes invoice dispatches without leaking internal request fields', () => {
    const service = createService();

    const result = (
      service as unknown as {
        serializeDispatch: (dispatch: {
          toObject: () => Record<string, unknown>;
        }) => Record<string, unknown>;
      }
    ).serializeDispatch({
      toObject: () => ({
        _id: 'dispatch-1',
        __v: 0,
        estimate_id: 'estimate-1',
        invoice_snapshot_id: 'snapshot-1',
        recipient_email: 'customer@example.com',
        provider: 'resend',
        provider_message_id: 'msg-1',
        provider_request_key: 'internal-key',
        delivery_status: 'ACCEPTED',
        error_message: null,
        sent_at: '2026-04-03T08:10:00.000Z',
        created_at: '2026-04-03T08:10:00.000Z',
        updated_at: '2026-04-03T08:11:00.000Z',
      }),
    });

    expect(result).toMatchObject({
      id: 'dispatch-1',
      estimate_id: 'estimate-1',
      invoice_snapshot_id: 'snapshot-1',
      delivery_status: 'ACCEPTED',
    });
    expect(result).not.toHaveProperty('_id');
    expect(result).not.toHaveProperty('__v');
    expect(result).not.toHaveProperty('provider_request_key');
  });
});
