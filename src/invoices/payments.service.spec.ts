import { BadRequestException, ConflictException } from '@nestjs/common';
import { PaymentsService } from './payments.service';

describe('PaymentsService ledger guards', () => {
  const actor = {
    user_id: '507f1f77bcf86cd7994390ac',
    organization_id: '507f1f77bcf86cd7994390aa',
    role: 'ADMIN',
    email: 'a@b.co',
    name: 'Admin',
  } as const;

  function buildService(doc: Record<string, unknown>) {
    const findOne = jest.fn().mockReturnValue({
      exec: jest.fn().mockResolvedValue(doc),
    });
    const ledgerFindOne = jest.fn().mockReturnValue({
      exec: jest.fn().mockResolvedValue(null),
    });
    const startSession = jest.fn().mockResolvedValue({
      withTransaction: async (fn: () => Promise<void>) => fn(),
      endSession: jest.fn(),
    });

    const service = new PaymentsService(
      {
        create: jest.fn(),
        findById: jest.fn(),
        findOne: jest.fn().mockReturnValue({
          lean: jest.fn().mockReturnValue({
            exec: jest.fn().mockResolvedValue(null),
          }),
        }),
      } as never,
      { findOne: ledgerFindOne, create: jest.fn(), find: jest.fn() } as never,
      { findOne } as never,
      { create: jest.fn() } as never,
      { startSession } as never,
    );

    return { service, findOne, startSession };
  }

  it('requires idempotency_key for manual payments', async () => {
    const { service } = buildService({
      _id: 'inv1',
      type: 'invoice',
      status: 'sent',
      balance_due_minor: 1000,
    });

    await expect(
      service.recordManualPayment(
        '507f1f77bcf86cd799439011',
        {
          amount_minor: 500,
          method: 'cash',
          reference: 'R1',
          note: 'cash',
        } as never,
        actor as never,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects payment that exceeds balance including zero balance', async () => {
    const doc = {
      _id: { toString: () => 'inv1' },
      type: 'invoice',
      status: 'sent',
      balance_due_minor: 0,
      total_minor: 1000,
      client_id: 'c1',
      amount_paid_minor: 1000,
      amount_refunded_minor: 0,
      amount_disputed_minor: 0,
      save: jest.fn(),
    };

    const findOne = jest.fn().mockReturnValue({
      exec: jest.fn().mockResolvedValue(doc),
    });
    const ledgerFindOne = jest
      .fn()
      .mockReturnValueOnce({ exec: jest.fn().mockResolvedValue(null) })
      .mockReturnValue({ exec: jest.fn().mockResolvedValue(null) });
    const startSession = jest.fn().mockResolvedValue({
      withTransaction: async (fn: () => Promise<void>) => fn(),
      endSession: jest.fn(),
    });

    const service = new PaymentsService(
      {
        create: jest.fn(),
        findById: jest.fn(),
        findOne: jest.fn().mockReturnValue({
          lean: jest.fn().mockReturnValue({
            exec: jest.fn().mockResolvedValue(null),
          }),
        }),
      } as never,
      {
        findOne: ledgerFindOne,
        create: jest.fn(),
        find: jest
          .fn()
          .mockReturnValue({ exec: jest.fn().mockResolvedValue([]) }),
      } as never,
      { findOne } as never,
      { create: jest.fn() } as never,
      { startSession } as never,
    );

    await expect(
      service.recordManualPayment(
        '507f1f77bcf86cd799439011',
        {
          amount_minor: 100,
          method: 'cash',
          reference: 'R1',
          note: 'extra',
          effective_at: '2026-08-08T12:00:00.000Z',
          idempotency_key: 'pay-1',
        } as never,
        actor as never,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('allows manual payment reference and note to be omitted', async () => {
    const doc = {
      _id: { toString: () => 'inv1' },
      type: 'invoice',
      status: 'sent',
      balance_due_minor: 1000,
      total_minor: 1000,
      client_id: '507f1f77bcf86cd799439013',
      amount_paid_minor: 0,
      amount_refunded_minor: 0,
      amount_disputed_minor: 0,
      version: 4,
      save: jest.fn().mockResolvedValue(undefined),
    };

    const paymentCreate = jest.fn().mockResolvedValue([
      {
        _id: 'pay1',
        amount_minor: 500,
      },
    ]);
    const ledgerCreate = jest.fn().mockResolvedValue([
      {
        _id: 'ledger1',
        payment_id: 'pay1',
        amount_minor: 500,
      },
    ]);
    const findOne = jest.fn().mockReturnValue({
      exec: jest.fn().mockResolvedValue(doc),
    });
    const ledgerFindOne = jest
      .fn()
      .mockReturnValue({ exec: jest.fn().mockResolvedValue(null) });
    const ledgerFind = jest.fn().mockReturnValue({
      exec: jest
        .fn()
        .mockResolvedValue([{ entry_type: 'payment', amount_minor: 500 }]),
    });
    const startSession = jest.fn().mockResolvedValue({
      withTransaction: async (fn: () => Promise<void>) => fn(),
      endSession: jest.fn(),
    });

    const service = new PaymentsService(
      {
        create: paymentCreate,
        findById: jest.fn(),
        findOne: jest.fn().mockReturnValue({
          lean: jest.fn().mockReturnValue({
            exec: jest.fn().mockResolvedValue(null),
          }),
        }),
      } as never,
      {
        findOne: ledgerFindOne,
        create: ledgerCreate,
        find: ledgerFind,
      } as never,
      { findOne } as never,
      { create: jest.fn() } as never,
      { startSession } as never,
    );

    await service.recordManualPayment(
      '507f1f77bcf86cd799439011',
      {
        amount_minor: 500,
        method: 'cash',
        reference: '   ',
        note: '',
        effective_at: '2026-08-08T12:00:00.000Z',
        idempotency_key: 'pay-blank-reference',
      } as never,
      actor as never,
    );

    expect(paymentCreate).toHaveBeenCalledWith(
      [
        expect.objectContaining({
          reference: null,
          note: null,
        }),
      ],
      expect.any(Object),
    );
    expect(doc.version).toBe(5);
    expect(doc.balance_due_minor).toBe(500);
  });

  it('rejects refunds on void invoices', async () => {
    const doc = {
      _id: { toString: () => 'inv1' },
      type: 'invoice',
      status: 'void',
      balance_due_minor: 0,
      total_minor: 1000,
      client_id: 'c1',
    };

    const findOne = jest.fn().mockReturnValue({
      exec: jest.fn().mockResolvedValue(doc),
    });
    const ledgerFindOne = jest.fn().mockReturnValue({
      exec: jest.fn().mockResolvedValue(null),
    });
    const startSession = jest.fn().mockResolvedValue({
      withTransaction: async (fn: () => Promise<void>) => fn(),
      endSession: jest.fn(),
    });

    const service = new PaymentsService(
      {
        create: jest.fn(),
        findById: jest.fn(),
        findOne: jest.fn().mockReturnValue({
          exec: jest.fn().mockResolvedValue({
            _id: 'p1',
            amount_minor: 500,
          }),
        }),
      } as never,
      {
        findOne: ledgerFindOne,
        create: jest.fn(),
        find: jest
          .fn()
          .mockReturnValue({ exec: jest.fn().mockResolvedValue([]) }),
      } as never,
      { findOne } as never,
      { create: jest.fn() } as never,
      { startSession } as never,
    );

    await expect(
      service.recordManualRefund(
        '507f1f77bcf86cd799439011',
        {
          payment_id: '507f1f77bcf86cd799439012',
          amount_minor: 100,
          reason: 'mistake',
          effective_at: '2026-08-08T12:00:00.000Z',
          idempotency_key: 'refund-1',
        } as never,
        actor as never,
      ),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('calculates dispute totals independently of ledger query order', async () => {
    const entries = [
      { entry_type: 'dispute_reversal', amount_minor: 500 },
      { entry_type: 'payment', amount_minor: 1000 },
      { entry_type: 'dispute_hold', amount_minor: -500 },
    ];
    const service = new PaymentsService(
      {} as never,
      {
        find: jest.fn().mockReturnValue({
          exec: jest.fn().mockResolvedValue(entries),
        }),
      } as never,
      {} as never,
      {} as never,
      {} as never,
    ) as unknown as {
      calculateTotalsFromLedger: (
        documentId: string,
        totalMinor: number,
      ) => Promise<{
        amountPaid: number;
        amountRefunded: number;
        amountDisputed: number;
        balanceDue: number;
      }>;
    };

    await expect(
      service.calculateTotalsFromLedger('invoice-id', 1000),
    ).resolves.toEqual({
      amountPaid: 1000,
      amountRefunded: 0,
      amountDisputed: 0,
      balanceDue: 0,
    });
  });

  it('never lets refunds or disputes push balance above invoice total', async () => {
    const entries = [
      { entry_type: 'payment', amount_minor: 200 },
      { entry_type: 'refund', amount_minor: -1000 },
      { entry_type: 'dispute_hold', amount_minor: -1000 },
    ];
    const service = new PaymentsService(
      {} as never,
      {
        find: jest.fn().mockReturnValue({
          exec: jest.fn().mockResolvedValue(entries),
        }),
      } as never,
      {} as never,
      {} as never,
      {} as never,
    ) as unknown as {
      calculateTotalsFromLedger: (
        documentId: string,
        totalMinor: number,
      ) => Promise<Record<string, number>>;
    };

    await expect(
      service.calculateTotalsFromLedger('invoice-id', 1000),
    ).resolves.toEqual({
      amountPaid: 200,
      amountRefunded: 200,
      amountDisputed: 0,
      balanceDue: 1000,
    });
  });
});
