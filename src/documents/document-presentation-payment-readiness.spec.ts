import { DocumentPresentationService } from './document-presentation.service';

describe('DocumentPresentationService payment readiness', () => {
  function buildService(config: Record<string, string | undefined>) {
    return new DocumentPresentationService(
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {
        get: jest.fn((key: string) => config[key]),
      } as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {
        exists: jest.fn().mockReturnValue({
          exec: jest.fn().mockResolvedValue(null),
        }),
      } as never,
    ) as unknown as {
      getPublicInvoicePaymentReadiness: (
        doc: Record<string, unknown>,
        permissions: string[],
      ) => Promise<{
        can_pay: boolean;
        disabled_reason: string | null;
      }>;
    };
  }

  function buildProcessingService(config: Record<string, string | undefined>) {
    const service = buildService(config);
    const paymentModel = (
      service as unknown as {
        paymentModel: {
          exists: jest.Mock;
        };
      }
    ).paymentModel;
    paymentModel.exists.mockReturnValue({
      exec: jest.fn().mockResolvedValue({ _id: 'payment-1' }),
    });
    return service;
  }

  const payableInvoice = {
    type: 'invoice',
    online_payments_enabled: true,
    status: 'sent',
    balance_due_minor: 25_000,
    client_snapshot: { email: 'client@example.com' },
  };

  it('does not show payment actions when Stripe is enabled but missing secrets', async () => {
    const service = buildService({
      ONLINE_INVOICE_PAYMENTS_ENABLED: 'true',
      STRIPE_SECRET_KEY: '',
      STRIPE_WEBHOOK_SECRET: 'whsec_test',
      PUBLIC_APP_BASE_URL: 'https://homepro.example',
    });

    const readiness = await service.getPublicInvoicePaymentReadiness(
      payableInvoice,
      ['view', 'download', 'pay'],
    );

    expect(readiness.can_pay).toBe(false);
    expect(readiness.disabled_reason).toBe(
      'Online payments are not fully configured yet.',
    );
  });

  it('enables Stripe Checkout when the checkout path is configured', async () => {
    const service = buildService({
      ONLINE_INVOICE_PAYMENTS_ENABLED: 'true',
      STRIPE_SECRET_KEY: 'sk_test_123',
      STRIPE_WEBHOOK_SECRET: 'whsec_test',
      PUBLIC_APP_BASE_URL: 'https://homepro.example',
    });

    const readiness = await service.getPublicInvoicePaymentReadiness(
      payableInvoice,
      ['view', 'download', 'pay'],
    );

    expect(readiness.can_pay).toBe(true);
    expect(readiness.disabled_reason).toBeNull();
  });

  it('disables duplicate checkout while a payment is processing', async () => {
    const service = buildProcessingService({
      ONLINE_INVOICE_PAYMENTS_ENABLED: 'true',
      STRIPE_SECRET_KEY: 'sk_test_123',
      STRIPE_WEBHOOK_SECRET: 'whsec_test',
      PUBLIC_APP_BASE_URL: 'https://homepro.example',
    });

    const readiness = await service.getPublicInvoicePaymentReadiness(
      payableInvoice,
      ['view', 'download', 'pay'],
    );

    expect(readiness.can_pay).toBe(false);
    expect(readiness.disabled_reason).toContain('payment is processing');
  });
});
