import { PublicInvoicePaymentsController } from './public-invoice-payments.controller';

describe('PublicInvoicePaymentsController', () => {
  it('starts one automatic Stripe Checkout flow', async () => {
    const createPublicCheckoutSession = jest
      .fn()
      .mockResolvedValue({ checkout_url: 'https://checkout.stripe.test/1' });
    const controller = new PublicInvoicePaymentsController({
      createPublicCheckoutSession,
    } as never);

    await expect(controller.createCheckout('public-token')).resolves.toEqual({
      checkout_url: 'https://checkout.stripe.test/1',
    });
    expect(createPublicCheckoutSession).toHaveBeenCalledWith('public-token');
  });
});
