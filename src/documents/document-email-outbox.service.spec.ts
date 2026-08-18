import { DocumentEmailOutboxService } from './document-email-outbox.service';
import { encryptBytes, encryptPublicPayload } from './document-token.crypto';

describe('DocumentEmailOutboxService', () => {
  const encryptionKey = 'test-outbox-encryption-key';

  function buildService(overrides?: {
    findOneAndUpdate?: jest.Mock;
    updateOne?: jest.Mock;
    emailsSend?: jest.Mock;
    transport?: string;
  }) {
    const findOneAndUpdate =
      overrides?.findOneAndUpdate ??
      jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue(null) });
    const updateOne =
      overrides?.updateOne ??
      jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue({}) });
    const documentUpdateOne = jest
      .fn()
      .mockReturnValue({ exec: jest.fn().mockResolvedValue({}) });

    const outboxModel = {
      create: jest.fn(),
      findOne: jest.fn(),
      findOneAndUpdate,
      updateOne,
    };
    const documentModel = {
      updateOne: documentUpdateOne,
    };
    const configService = {
      get: jest.fn((key: string) => {
        if (key === 'INVOICE_EMAIL_TRANSPORT') {
          return overrides?.transport ?? 'RESEND';
        }
        if (key === 'INVOICE_EMAIL_FROM') {
          return 'ops@example.com';
        }
        if (key === 'OUTBOX_ENCRYPTION_KEY') {
          return encryptionKey;
        }
        return undefined;
      }),
      getOrThrow: jest.fn((key: string) => {
        if (key === 'INVOICE_EMAIL_RESEND_API_KEY') {
          return 're_test';
        }
        throw new Error(`missing ${key}`);
      }),
    };

    const service = new DocumentEmailOutboxService(
      outboxModel as never,
      documentModel as never,
      configService as never,
    );

    if (overrides?.emailsSend) {
      (
        service as unknown as {
          getResendClient: () => { emails: { send: jest.Mock } };
        }
      ).getResendClient = () => ({
        emails: { send: overrides.emailsSend! },
      });
    }

    return {
      service,
      findOneAndUpdate,
      updateOne,
      documentUpdateOne,
    };
  }

  it('reclaims expired processing leases', async () => {
    const findOneAndUpdate = jest.fn().mockReturnValue({
      exec: jest.fn().mockResolvedValue(null),
    });
    const { service } = buildService({
      findOneAndUpdate,
      transport: 'LOG',
    });

    await service.processDue(1);

    const filter = findOneAndUpdate.mock.calls[0][0];
    expect(filter.$or).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          status: 'processing',
          lease_until: expect.objectContaining({ $lte: expect.any(Date) }),
        }),
      ]),
    );
  });

  it('treats Resend result.error as a failed attempt', async () => {
    const emailsSend = jest.fn().mockResolvedValue({
      data: null,
      error: { message: 'provider rejected' },
    });
    const updateOne = jest
      .fn()
      .mockReturnValue({ exec: jest.fn().mockResolvedValue({}) });
    const findOneAndUpdate = jest.fn().mockReturnValue({
      exec: jest.fn().mockResolvedValue({
        _id: 'row-1',
        attempt_count: 1,
        encrypted_public_payload: encryptPublicPayload(
          {
            token: 'tok',
            public_url: 'http://127.0.0.1:3000/view/estimate/tok',
          },
          encryptionKey,
        ),
        email_snapshot: {
          company_name: 'Acme',
          client_display_name: 'Client',
          document_number: 'EST-1',
          total_minor: 100,
        },
        recipient_email: 'a@example.com',
        document_version: 1,
        document_hash: 'hash',
        document_id: '507f1f77bcf86cd799439011',
        organization_id: '507f1f77bcf86cd799439012',
        template_key: 'estimate.send',
        idempotency_key: 'idem-1',
      }),
    });

    const { service, documentUpdateOne } = buildService({
      findOneAndUpdate,
      updateOne,
      emailsSend,
    });

    await service.processDue(1);

    expect(emailsSend).toHaveBeenCalled();
    const failUpdate = updateOne.mock.calls.find((call) =>
      JSON.stringify(call[1]).includes('provider rejected'),
    );
    expect(failUpdate).toBeTruthy();
    expect(documentUpdateOne).not.toHaveBeenCalled();
  });

  it('sends invoice attachments with the neutral document number filename', async () => {
    const emailsSend = jest.fn().mockResolvedValue({
      data: { id: 'msg-1' },
      error: null,
    });
    const updateOne = jest
      .fn()
      .mockReturnValue({ exec: jest.fn().mockResolvedValue({}) });
    const findOneAndUpdate = jest.fn().mockReturnValue({
      exec: jest.fn().mockResolvedValue({
        _id: 'row-2',
        attempt_count: 1,
        encrypted_public_payload: encryptPublicPayload(
          {
            token: 'tok',
            public_url: 'http://127.0.0.1:3000/view/invoice/tok',
          },
          encryptionKey,
        ),
        encrypted_pdf_payload: encryptBytes(Buffer.from('%PDF'), encryptionKey),
        email_snapshot: {
          company_name: 'Acme',
          client_display_name: 'Client',
          document_number: 'INV-1001',
          total_minor: 100,
        },
        recipient_email: 'a@example.com',
        document_version: 1,
        document_hash: 'hash',
        document_id: '507f1f77bcf86cd799439011',
        organization_id: '507f1f77bcf86cd799439012',
        template_key: 'invoice.send',
        idempotency_key: 'idem-2',
      }),
    });

    const { service } = buildService({
      findOneAndUpdate,
      updateOne,
      emailsSend,
    });

    await service.processDue(1);

    expect(emailsSend).toHaveBeenCalledWith(
      expect.objectContaining({
        attachments: [
          expect.objectContaining({
            filename: 'INV-1001.pdf',
            contentType: 'application/pdf',
          }),
        ],
      }),
      expect.objectContaining({ idempotencyKey: 'idem-2' }),
    );
  });

  it('resets attempt_count on manual retryFailed', async () => {
    const findOneAndUpdate = jest.fn().mockReturnValue({
      exec: jest
        .fn()
        .mockResolvedValue({ status: 'pending', attempt_count: 0 }),
    });
    const { service } = buildService({ findOneAndUpdate });

    await service.retryFailed(
      '507f1f77bcf86cd799439011',
      '507f1f77bcf86cd799439012',
    );

    expect(findOneAndUpdate.mock.calls[0][1]).toEqual(
      expect.objectContaining({
        $set: expect.objectContaining({
          status: 'pending',
          attempt_count: 0,
        }),
      }),
    );
  });
});
