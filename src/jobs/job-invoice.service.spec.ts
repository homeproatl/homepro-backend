import { ServiceUnavailableException } from '@nestjs/common';
import type { SendMailOptions } from 'nodemailer';
import { renderInvoiceEmailMessageHtml } from './invoice-template';
import { JobInvoiceService } from './job-invoice.service';
import { JobInvoiceSnapshotStatus } from './enums/job-invoice-snapshot-status.enum';

describe('JobInvoiceService', () => {
  function createService(overrides?: {
    jobInvoiceSnapshotModel?: object;
    appSettingsModel?: object;
    configService?: object;
  }) {
    return new JobInvoiceService(
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      (overrides?.jobInvoiceSnapshotModel ?? {}) as never,
      {} as never,
      (overrides?.appSettingsModel ?? {}) as never,
      {} as never,
      (overrides?.configService ?? {}) as never,
    );
  }

  function createInvoicePayload() {
    return {
      invoice_number: 'INV-123456',
      job_id: 'job-1',
      job_number_snapshot: 'JOB-001',
      title_snapshot: 'Inspection',
      time_zone_snapshot: 'America/New_York',
      customer_snapshot: {
        customer_id: 'c1',
        name: 'Rico Customer',
        email: 'customer@test.com',
        phone: '555-1000',
      },
      vehicle_snapshot: {
        vehicle_id: 'v1',
        label: 'ABC-123 · Toyota Camry',
        vin: 'VIN123',
        license_plate: 'ABC-123',
      },
      services_snapshot: [
        {
          job_service_id: 'js1',
          service_id: 's1',
          name: 'Oil Change',
          quantity: 1,
          unit_price_snapshot: 100,
          sub_total: 100,
        },
      ],
      parts_snapshot: [
        {
          job_part_id: 'jp1',
          part_name: 'Oil',
          quantity: 1,
          unit_price: 50,
          sub_total: 50,
        },
      ],
      total: 150,
      payment_status_snapshot: 'UNPAID',
      payment_type_snapshot: 'POS_CARD',
      due_date_snapshot: '2026-03-29T00:00:00.000Z',
      scheduled_start_snapshot: null,
      scheduled_end_snapshot: null,
      generated_at: '2026-03-23T00:00:00.000Z',
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
      jobInvoiceSnapshotModel: {
        findOne,
        create,
      },
    });

    await (
      service as unknown as {
        createSnapshot: (aggregate: unknown) => Promise<void>;
      }
    ).createSnapshot({
      job: { _id: 'job-1' },
      payload: {
        customer_snapshot: {},
        vehicle_snapshot: {},
        services_snapshot: [],
        parts_snapshot: [],
        job_number_snapshot: 'JOB-001',
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
          }) => Promise<void>;
        }
      ).sendInvoiceEmail({
        invoiceNumber: 'INV-123456',
        recipientEmail: 'customer@test.com',
        html: '<html></html>',
        text: 'Invoice text',
        pdfBytes: Uint8Array.of(1, 2, 3),
      }),
    ).toThrow(ServiceUnavailableException);
  });

  it('uses SMTP transport for real invoice delivery when configured', async () => {
    const service = createService({
      configService: {
        get: jest.fn((key: string) => {
          if (key === 'INVOICE_EMAIL_TRANSPORT') {
            return 'SMTP';
          }

          if (key === 'INVOICE_EMAIL_FROM') {
            return 'billing@rico.local';
          }

          return undefined;
        }),
      },
    });
    const sendMail = jest
      .fn<Promise<{ messageId: string }>, [SendMailOptions]>()
      .mockResolvedValue({ messageId: 'smtp-message-1' });

    jest
      .spyOn(
        service as unknown as {
          getSmtpTransport: () => { sendMail: typeof sendMail };
        },
        'getSmtpTransport',
      )
      .mockReturnValue({ sendMail });

    await expect(
      (
        service as unknown as {
          sendInvoiceEmail: (input: {
            invoiceNumber: string;
            recipientEmail: string;
            html: string;
            text: string;
            pdfBytes: Uint8Array;
          }) => Promise<{ provider: string; providerMessageId: string }>;
        }
      ).sendInvoiceEmail({
        invoiceNumber: 'INV-123456',
        recipientEmail: 'customer@test.com',
        html: '<html><body>Invoice Attached</body></html>',
        text: 'Dear Rico Customer,\n\nPlease open the attached PDF to review the complete invoice details.',
        pdfBytes: Uint8Array.of(1, 2, 3),
      }),
    ).resolves.toEqual({
      provider: 'smtp',
      providerMessageId: 'smtp-message-1',
    });

    expect(sendMail).toHaveBeenCalledWith(
      expect.objectContaining({
        from: 'billing@rico.local',
        to: 'customer@test.com',
        subject: 'Invoice INV-123456 from Rico Workshop',
        attachments: [
          expect.objectContaining({
            filename: 'INV-123456.pdf',
            contentType: 'application/pdf',
          }),
        ],
      }),
    );

    const mailPayload = sendMail.mock.calls[0]?.[0];
    expect(mailPayload?.html).toContain('Invoice Attached');
    expect(mailPayload?.text).toContain(
      'Please open the attached PDF to review the complete invoice details.',
    );
  });

  it('uses the live preview document for PDF download when the latest snapshot is stale', async () => {
    const service = createService();
    const aggregate = {
      job: { job_number: 'JOB-001' },
      payload: {
        job_id: 'job-1',
        job_number_snapshot: 'JOB-001',
        title_snapshot: 'Inspection',
        time_zone_snapshot: 'America/New_York',
        customer_snapshot: {
          customer_id: 'c1',
          name: 'Rico Customer',
          email: 'customer@test.com',
          phone: '555-1000',
        },
        vehicle_snapshot: {
          vehicle_id: 'v1',
          label: 'ABC-123 · Toyota Camry',
          vin: 'VIN123',
          license_plate: 'ABC-123',
        },
        services_snapshot: [],
        parts_snapshot: [],
        total: 100,
        payment_status_snapshot: 'UNPAID',
        payment_type_snapshot: 'POS_CARD',
        due_date_snapshot: null,
        scheduled_start_snapshot: null,
        scheduled_end_snapshot: null,
        generated_at: '2026-03-21T00:00:00.000Z',
      },
    };
    const staleSnapshot = {
      status: JobInvoiceSnapshotStatus.STALE,
      invoice_number: 'INV-OLD',
    };
    const renderInvoicePdf = jest
      .spyOn(
        service as unknown as {
          renderInvoicePdf: (invoice: unknown) => Promise<Uint8Array>;
        },
        'renderInvoicePdf',
      )
      .mockResolvedValue(Uint8Array.of(1, 2, 3));

    jest
      .spyOn(
        service as unknown as {
          loadInvoiceAggregate: (jobId: string) => Promise<typeof aggregate>;
        },
        'loadInvoiceAggregate',
      )
      .mockResolvedValue(aggregate);
    jest
      .spyOn(
        service as unknown as {
          reconcileLatestSnapshot: (
            input: unknown,
          ) => Promise<typeof staleSnapshot>;
        },
        'reconcileLatestSnapshot',
      )
      .mockResolvedValue(staleSnapshot);

    const result = await service.getInvoicePdf('job-1');

    expect(renderInvoicePdf).toHaveBeenCalledWith(aggregate.payload);
    expect(result.fileName).toBe('JOB-001-preview.pdf');
  });

  it('reports send_ready as false in the job billing summary when runtime send blockers exist', async () => {
    const service = createService();

    jest
      .spyOn(
        service as unknown as {
          loadInvoiceAggregate: (jobId: string) => Promise<unknown>;
        },
        'loadInvoiceAggregate',
      )
      .mockResolvedValue({
        job: { _id: 'job-1' },
        blockers: [],
        payload: {},
        billableHash: 'hash-1',
      });
    jest
      .spyOn(
        service as unknown as {
          reconcileLatestSnapshot: (aggregate: unknown) => Promise<unknown>;
        },
        'reconcileLatestSnapshot',
      )
      .mockResolvedValue({
        status: JobInvoiceSnapshotStatus.ISSUED,
        invoice_number: 'INV-123456',
      });
    jest
      .spyOn(
        service as unknown as {
          getInvoiceBillingReadiness: (aggregate: unknown) => Promise<{
            pdfBlockers: string[];
            sendBlockers: string[];
          }>;
        },
        'getInvoiceBillingReadiness',
      )
      .mockResolvedValue({
        pdfBlockers: [
          'Invoice PDF rendering is unavailable. Verify the bundled Chromium runtime before sending or downloading invoices.',
        ],
        sendBlockers: [
          'Invoice PDF rendering is unavailable. Verify the bundled Chromium runtime before sending or downloading invoices.',
        ],
      });

    await expect(service.getJobBillingSummary('job-1')).resolves.toEqual({
      invoice_status: JobInvoiceSnapshotStatus.ISSUED,
      latest_invoice_number: 'INV-123456',
      invoice_ready: true,
      send_ready: false,
      invoice_needs_refresh: false,
    });
  });

  it('renders the invoice email HTML with the public preview layout structure', () => {
    const service = createService();

    const html = (
      service as unknown as {
        renderInvoiceHtml: (invoice: unknown) => string;
      }
    ).renderInvoiceHtml(createInvoicePayload());

    expect(html).toContain('max-width:760px');
    expect(html).toContain('Service Invoice');
    expect(html).toContain('Services');
    expect(html).toContain('Parts Used');
    expect(html).toContain('Service &amp; Repair Billing');
    expect(html).toContain('Payment Status Unpaid');
    expect(html).toContain(
      'This invoice reflects the billing snapshot and payment status captured for this job.',
    );
  });

  it('renders a short formal email body that points the customer to the attached PDF', () => {
    const html = renderInvoiceEmailMessageHtml({
      invoiceNumber: 'INV-123456',
      customerName: 'Rico Customer',
      jobNumber: 'JOB-001',
      total: 150,
      dueDate: '2026-03-29T00:00:00.000Z',
      timeZone: 'America/New_York',
    });

    expect(html).toContain('Invoice Attached');
    expect(html).toContain('Thank you for choosing Rico Workshop.');
    expect(html).toContain(
      'Please open the attached PDF to review the complete invoice details.',
    );
    expect(html).not.toContain('Service Invoice');
  });

  it('renders invoice PDFs from the same HTML template through the browser renderer', async () => {
    const service = createService();
    const payload = createInvoicePayload();
    const setViewport = jest.fn().mockResolvedValue(undefined);
    const setContent = jest.fn().mockResolvedValue(undefined);
    const pdf = jest.fn().mockResolvedValue(Buffer.from([1, 2, 3]));
    const close = jest.fn().mockResolvedValue(undefined);
    const renderInvoiceHtml = jest.spyOn(
      service as unknown as {
        renderInvoiceHtml: (invoice: unknown) => string;
      },
      'renderInvoiceHtml',
    );

    jest
      .spyOn(
        service as unknown as {
          getPdfBrowser: () => Promise<{ newPage: () => Promise<unknown> }>;
        },
        'getPdfBrowser',
      )
      .mockResolvedValue({
        newPage: () =>
          Promise.resolve({
            setViewport,
            setContent,
            pdf,
            close,
          }),
      });

    const result = await (
      service as unknown as {
        renderInvoicePdf: (invoice: unknown) => Promise<Uint8Array>;
      }
    ).renderInvoicePdf(payload);

    expect(renderInvoiceHtml).toHaveBeenCalledWith(payload);
    expect(setContent).toHaveBeenCalledWith(
      expect.stringContaining('Service Invoice'),
      {
        waitUntil: ['domcontentloaded', 'load', 'networkidle0'],
      },
    );
    expect(pdf).toHaveBeenCalledWith(
      expect.objectContaining({
        format: 'Letter',
        printBackground: true,
        preferCSSPageSize: true,
      }),
    );
    expect(result).toEqual(Uint8Array.of(1, 2, 3));
  });

  it('reports PDF blockers in invoice readiness when the browser renderer is unavailable', async () => {
    const service = createService({
      configService: {
        get: jest.fn((key: string) => {
          if (key === 'INVOICE_EMAIL_TRANSPORT') {
            return 'SMTP';
          }

          if (key === 'INVOICE_EMAIL_FROM') {
            return 'billing@rico.local';
          }

          return undefined;
        }),
      },
    });
    const aggregate = {
      job: { _id: 'job-1' },
      blockers: [],
      payload: createInvoicePayload(),
    };
    const pdfBlocker =
      'Invoice PDF rendering is unavailable. Verify the bundled Chromium runtime before sending or downloading invoices.';

    jest
      .spyOn(
        service as unknown as {
          loadInvoiceAggregate: (jobId: string) => Promise<typeof aggregate>;
        },
        'loadInvoiceAggregate',
      )
      .mockResolvedValue(aggregate as never);
    jest
      .spyOn(
        service as unknown as {
          reconcileLatestSnapshot: (aggregate: unknown) => Promise<null>;
        },
        'reconcileLatestSnapshot',
      )
      .mockResolvedValue(null);
    jest
      .spyOn(
        service as unknown as {
          getPdfBlockers: () => Promise<string[]>;
        },
        'getPdfBlockers',
      )
      .mockResolvedValue([pdfBlocker]);

    const result = await service.getInvoicePreview('job-1');

    expect(result.pdf_ready).toBe(false);
    expect(result.pdf_blockers).toEqual([pdfBlocker]);
    expect(result.send_ready).toBe(false);
    expect(result.send_blockers).toContain(pdfBlocker);
  });

  it('resets the cached PDF browser after renderer failures so the next request can relaunch', async () => {
    const service = createService();
    const resetPdfBrowser = jest
      .spyOn(
        service as unknown as {
          resetPdfBrowser: () => Promise<void>;
        },
        'resetPdfBrowser',
      )
      .mockResolvedValue(undefined);

    jest
      .spyOn(
        service as unknown as {
          getPdfBrowser: () => Promise<{ newPage: () => Promise<never> }>;
        },
        'getPdfBrowser',
      )
      .mockResolvedValue({
        newPage: () => Promise.reject(new Error('browser disconnected')),
      });

    await expect(
      (
        service as unknown as {
          renderInvoicePdf: (invoice: unknown) => Promise<Uint8Array>;
        }
      ).renderInvoicePdf(createInvoicePayload()),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);

    expect(resetPdfBrowser).toHaveBeenCalledTimes(1);
  });

  it('includes payment status in the billable hash so payment-only changes stale invoices', () => {
    const service = createService();

    const unpaidHash = (
      service as unknown as {
        buildBillableHash: (payload: unknown) => string;
      }
    ).buildBillableHash({
      job_number_snapshot: 'JOB-001',
      title_snapshot: 'Inspection',
      time_zone_snapshot: 'America/New_York',
      customer_snapshot: {
        customer_id: 'c1',
        name: 'Rico Customer',
        email: 'customer@test.com',
        phone: '555-1000',
      },
      vehicle_snapshot: {
        vehicle_id: 'v1',
        label: 'ABC-123 · Toyota Camry',
        vin: 'VIN123',
        license_plate: 'ABC-123',
      },
      services_snapshot: [],
      parts_snapshot: [],
      total: 100,
      payment_status_snapshot: 'UNPAID',
      payment_type_snapshot: 'POS_CARD',
      due_date_snapshot: null,
      scheduled_start_snapshot: null,
      scheduled_end_snapshot: null,
    });

    const paidHash = (
      service as unknown as {
        buildBillableHash: (payload: unknown) => string;
      }
    ).buildBillableHash({
      job_number_snapshot: 'JOB-001',
      title_snapshot: 'Inspection',
      time_zone_snapshot: 'America/New_York',
      customer_snapshot: {
        customer_id: 'c1',
        name: 'Rico Customer',
        email: 'customer@test.com',
        phone: '555-1000',
      },
      vehicle_snapshot: {
        vehicle_id: 'v1',
        label: 'ABC-123 · Toyota Camry',
        vin: 'VIN123',
        license_plate: 'ABC-123',
      },
      services_snapshot: [],
      parts_snapshot: [],
      total: 100,
      payment_status_snapshot: 'PAID',
      payment_type_snapshot: 'POS_CARD',
      due_date_snapshot: null,
      scheduled_start_snapshot: null,
      scheduled_end_snapshot: null,
    });

    expect(unpaidHash).not.toBe(paidHash);
  });
});
