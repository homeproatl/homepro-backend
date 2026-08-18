import { ConflictException } from '@nestjs/common';
import { StripePaymentsService } from './stripe-payments.service';

describe('StripePaymentsService stability guards', () => {
  function buildService(
    overrides: {
      inboxModel?: Record<string, unknown>;
      paymentNotifications?: Record<string, unknown>;
    } = {},
  ) {
    return new StripePaymentsService(
      {} as never,
      {} as never,
      {} as never,
      (overrides.paymentNotifications ?? {}) as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      (overrides.inboxModel ?? {}) as never,
      {} as never,
    ) as unknown as {
      claimInboxEvent: (eventId: string) => Promise<unknown>;
      recoverOrReuseCheckout: (
        input: Record<string, unknown>,
      ) => Promise<unknown>;
      retireOrBlockStaleCheckout: (
        payment: Record<string, unknown>,
        runtime: Record<string, unknown>,
      ) => Promise<unknown>;
      sendPaymentNotificationSafely: (
        input: Record<string, unknown>,
      ) => Promise<void>;
      createStripeCheckoutSession: (
        input: Record<string, unknown>,
      ) => Promise<unknown>;
      resolveActualCheckoutMethod: (
        paymentIntent: string | Record<string, unknown>,
        runtime: Record<string, unknown>,
      ) => Promise<{
        method: 'ach' | 'card' | 'other';
        providerType: string;
      } | null>;
    };
  }

  it('uses dynamic Stripe payment methods instead of hardcoding a method list', async () => {
    const service = buildService();
    let capturedParams: Record<string, unknown> = {};
    const create = jest.fn((params: Record<string, unknown>) => {
      capturedParams = params;
      return Promise.resolve({ id: 'cs_test' });
    });
    Object.assign(service, {
      getStripe: () => ({ checkout: { sessions: { create } } }),
    });

    await service.createStripeCheckoutSession({
      runtime: {
        publicAppBaseUrl: 'https://app.homepro.example',
        currency: 'usd',
      },
      document: {
        _id: '66b123456789abcdef123456',
        organization_id: '66b123456789abcdef123450',
        client_id: '66b123456789abcdef123451',
        number: 'INV-000001',
        balance_due_minor: 10_000,
        job_name: null,
        client_snapshot: { display_name: 'Client' },
      },
      method: 'automatic',
      payment: { _id: '66b123456789abcdef123452' },
      customerId: 'cus_test',
      customerEmail: 'client@example.com',
      token: 'public-token',
      source: 'public_invoice',
    });

    expect(capturedParams).not.toHaveProperty('payment_method_types');
    expect(capturedParams).not.toHaveProperty('payment_method_options');
    expect(capturedParams.integration_identifier).toMatch(/^homepro_[a-p]{8}$/);
  });

  it('resolves the payment method actually selected in Stripe Checkout', async () => {
    const service = buildService();
    const retrieveIntent = jest.fn().mockResolvedValue({
      payment_method: { type: 'card' },
    });
    Object.assign(service, {
      getStripe: () => ({
        paymentIntents: { retrieve: retrieveIntent },
        paymentMethods: { retrieve: jest.fn() },
      }),
    });

    await expect(
      service.resolveActualCheckoutMethod('pi_card', {}),
    ).resolves.toEqual({ method: 'card', providerType: 'card' });
    expect(retrieveIntent).toHaveBeenCalledWith('pi_card', {
      expand: ['payment_method'],
    });
    await expect(
      service.resolveActualCheckoutMethod(
        { payment_method: { type: 'us_bank_account' } },
        {},
      ),
    ).resolves.toEqual({
      method: 'ach',
      providerType: 'us_bank_account',
    });
    await expect(
      service.resolveActualCheckoutMethod(
        { payment_method: { type: 'cashapp' } },
        {},
      ),
    ).resolves.toEqual({ method: 'other', providerType: 'cashapp' });
    await expect(
      service.resolveActualCheckoutMethod(
        {
          payment_method: {
            type: 'card',
            card: { wallet: { type: 'apple_pay' } },
          },
        },
        {},
      ),
    ).resolves.toEqual({ method: 'card', providerType: 'apple_pay' });
  });

  it('claims a webhook with one atomic find-and-update lease', async () => {
    const exec = jest.fn().mockResolvedValue({ stripe_event_id: 'evt_123' });
    const lean = jest.fn().mockReturnValue({ exec });
    const findOneAndUpdate = jest.fn().mockReturnValue({ lean });
    const service = buildService({ inboxModel: { findOneAndUpdate } });

    await expect(service.claimInboxEvent('evt_123')).resolves.toEqual({
      stripe_event_id: 'evt_123',
    });
    expect(findOneAndUpdate).toHaveBeenCalledTimes(1);
    const [filter, update, options] = findOneAndUpdate.mock.calls[0] as [
      { stripe_event_id: string },
      { $set: { processing_status: string } },
      { new: boolean },
    ];
    expect(filter.stripe_event_id).toBe('evt_123');
    expect(update.$set.processing_status).toBe('processing');
    expect(options).toEqual({ new: true });
  });

  it('blocks another checkout while a payment is processing', async () => {
    const service = buildService();

    await expect(
      service.recoverOrReuseCheckout({
        payment: { status: 'processing' },
      }),
    ).rejects.toThrow(
      new ConflictException(
        'A payment is already processing for this invoice.',
      ),
    );
  });

  it('blocks invoice mutation while a payment is processing', async () => {
    const service = buildService();

    await expect(
      service.retireOrBlockStaleCheckout({ status: 'processing' }, {}),
    ).rejects.toThrow(
      new ConflictException(
        'A payment is already processing for this invoice.',
      ),
    );
  });

  it('does not fail a recorded webhook when payment email delivery fails', async () => {
    const send = jest.fn().mockRejectedValue(new Error('Resend unavailable'));
    const service = buildService({ paymentNotifications: { send } });

    await expect(
      service.sendPaymentNotificationSafely({
        payment: { _id: 'pay_1' },
        eventType: 'payment.succeeded',
        message: 'Invoice payment received.',
      }),
    ).resolves.toBeUndefined();
    expect(send).toHaveBeenCalledTimes(1);
  });
});
