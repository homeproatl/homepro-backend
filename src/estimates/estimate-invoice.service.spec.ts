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
      expect.objectContaining({ revision_number: 4 }),
    );
    expect(create).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ revision_number: 5 }),
    );
  });

  it('does not treat LOG transport as a successful email delivery', async () => {
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

  it('renders invoice pdf html with document metadata, line item table, and totals summary', () => {
    const html = renderInvoiceDocumentHtml({
      invoiceNumber: 'INV-123456',
      estimateNumber: 'EST-001',
      title: 'Brake Service',
      timeZone: 'America/New_York',
      customerComment: null,
      recommendation: null,
      customerName: 'Rico Customer',
      customerEmail: 'customer@test.com',
      customerPhone: '555-0100',
      vehicleLabel: 'ABC-123 · Toyota Camry',
      vehicleVin: 'VIN-123',
      vehiclePlate: 'ABC-123',
      dueDate: '2026-03-29T00:00:00.000Z',
      generatedAt: '2026-03-25T00:00:00.000Z',
      paymentStatus: 'UNPAID',
      paymentType: 'POS_CARD',
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
    expect(html).toContain('Document No.');
    expect(html).toContain('Customer Comment');
    expect(html).toContain('Recommendation');
    expect(html).toContain('Rate / hr');
    expect(html).toContain('Part used');
    expect(html).toContain('Labor subtotal');
    expect(html).toContain('Parts subtotal');
    expect(html).toContain('Total due');
    expect(html).toContain('Brake Service');
    expect(html).toContain('Brake labor');
    expect(html).toContain('font-weight:500;color:#000000;">Labor rates</th>');
    expect(html).toContain('font-weight:500;color:#000000;">Part used</th>');
    expect(html).toContain('M Rico');
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
      dueDate: '2026-03-29T00:00:00.000Z',
      generatedAt: '2026-03-25T00:00:00.000Z',
      paymentStatus: 'PART_PAID',
      paymentType: 'POS_CARD',
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
    expect(html).toContain('Part paid');
    expect(html).toContain('-$230.00');
    expect(html).toContain('Total due');
    expect(html).toContain('$230.00');
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
      dueDate: '2026-03-29T00:00:00.000Z',
      generatedAt: '2026-03-25T00:00:00.000Z',
      paymentStatus: 'PART_PAID',
      paymentType: 'POS_CARD',
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
