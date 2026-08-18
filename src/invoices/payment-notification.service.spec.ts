import { PaymentNotificationService } from './payment-notification.service';

describe('PaymentNotificationService', () => {
  it('sends payment email to the saved Company email', async () => {
    const send = jest.fn().mockResolvedValue({
      data: { id: 'email-1' },
      error: null,
    });
    const config = {
      get: jest.fn((key: string) => {
        if (key === 'INVOICE_EMAIL_TRANSPORT') return 'RESEND';
        if (key === 'INVOICE_EMAIL_FROM') return 'Home Pro <billing@test.co>';
        if (key === 'INVOICE_EMAIL_RESEND_API_KEY') return 're_test';
        return undefined;
      }),
    };
    const settings = {
      getSnapshotSource: jest.fn().mockResolvedValue({
        company: {
          email: 'office@homepro.test',
          display_name: 'Home Pro',
          legal_name: null,
        },
      }),
    };
    const documentModel = {
      findOne: jest.fn().mockReturnValue({
        select: jest.fn().mockReturnThis(),
        lean: jest.fn().mockReturnThis(),
        exec: jest.fn().mockResolvedValue({
          number: 'INV-101',
          client_snapshot: { display_name: 'Pat Client' },
          balance_due_minor: 2500,
        }),
      }),
    };
    const service = new PaymentNotificationService(
      config as never,
      settings as never,
      documentModel as never,
    );
    Object.defineProperty(service, 'resendClient', {
      value: { emails: { send } },
      writable: true,
    });

    await service.send({
      payment: {
        _id: 'payment-1',
        organization_id: 'org-1',
        document_id: 'invoice-1',
        amount_minor: 7500,
        status: 'succeeded',
      } as never,
      eventType: 'payment.succeeded',
      message: 'Invoice payment received.',
    });

    expect(send).toHaveBeenCalledTimes(1);
    const [message, options] = send.mock.calls[0] as [
      { to: string[]; subject: string },
      { idempotencyKey: string },
    ];
    expect(message.to).toEqual(['office@homepro.test']);
    expect(message.subject).toBe('Home Pro: Invoice payment received. INV-101');
    expect(options.idempotencyKey).toContain('payment-notification');
  });
});
