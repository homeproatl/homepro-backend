import { ServiceUnavailableException } from '@nestjs/common';
import { renderInvoiceEmailMessageHtml } from './invoice-template';
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
});
