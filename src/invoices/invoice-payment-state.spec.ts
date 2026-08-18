import { computeInvoicePaymentDisplay } from './invoice-payment-state';

describe('computeInvoicePaymentDisplay', () => {
  const base = {
    total_minor: 10_000,
    amount_paid_minor: 0,
    amount_refunded_minor: 0,
    amount_disputed_minor: 0,
    balance_due_minor: 10_000,
    due_date: null as Date | string | null,
    status: 'issued',
    now: new Date('2026-08-05T12:00:00.000Z'),
  };

  it('returns disputed when amount_disputed_minor > 0', () => {
    expect(
      computeInvoicePaymentDisplay({
        ...base,
        amount_disputed_minor: 500,
        amount_paid_minor: 5_000,
        balance_due_minor: 5_000,
      }),
    ).toBe('disputed');
  });

  it('returns refunded when refunded >= paid and paid > 0', () => {
    expect(
      computeInvoicePaymentDisplay({
        ...base,
        amount_paid_minor: 5_000,
        amount_refunded_minor: 5_000,
        balance_due_minor: 10_000,
      }),
    ).toBe('refunded');
  });

  it('returns paid when balance <= 0 and paid > 0', () => {
    expect(
      computeInvoicePaymentDisplay({
        ...base,
        amount_paid_minor: 10_000,
        balance_due_minor: 0,
      }),
    ).toBe('paid');
  });

  it('returns partial when paid > 0 and balance > 0', () => {
    expect(
      computeInvoicePaymentDisplay({
        ...base,
        amount_paid_minor: 4_000,
        balance_due_minor: 6_000,
        due_date: '2026-07-01T00:00:00.000Z',
      }),
    ).toBe('partial');
  });

  it('returns overdue when unpaid, due date past, and not void/draft', () => {
    expect(
      computeInvoicePaymentDisplay({
        ...base,
        due_date: '2026-08-01T00:00:00.000Z',
        status: 'sent',
      }),
    ).toBe('overdue');
  });

  it('does not mark draft as overdue even when due date is past', () => {
    expect(
      computeInvoicePaymentDisplay({
        ...base,
        due_date: '2026-07-01T00:00:00.000Z',
        status: 'draft',
      }),
    ).toBe('unpaid');
  });

  it('does not mark void as overdue', () => {
    expect(
      computeInvoicePaymentDisplay({
        ...base,
        due_date: '2026-07-01T00:00:00.000Z',
        status: 'void',
      }),
    ).toBe('unpaid');
  });

  it('returns unpaid for zero-paid issued invoice with future due date', () => {
    expect(
      computeInvoicePaymentDisplay({
        ...base,
        due_date: '2026-08-20T00:00:00.000Z',
        status: 'issued',
      }),
    ).toBe('unpaid');
  });

  it('treats due date string and Date equivalently', () => {
    expect(
      computeInvoicePaymentDisplay({
        ...base,
        due_date: new Date('2026-08-01T00:00:00.000Z'),
        status: 'issued',
      }),
    ).toBe('overdue');
  });
});
