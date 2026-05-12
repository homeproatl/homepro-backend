import {
  DEFAULT_ESTIMATE_TAX_RATE_PERCENT,
  calculateEstimateTotals,
  calculateLaborSubtotal,
  calculatePartSubtotal,
  calculateServiceTotals,
  resolveEstimatePaymentState,
  resolveEstimateTotals,
} from './estimate-calculators';

describe('estimate calculators', () => {
  it('computes discounted labor and part subtotals deterministically', () => {
    expect(calculateLaborSubtotal(2, 99.995)).toBe(199.99);
    expect(calculateLaborSubtotal(2, 100, 10)).toBe(180);
    expect(calculatePartSubtotal(2, 12.345)).toBe(24.69);
    expect(calculatePartSubtotal(2, 10, 25)).toBe(15);
  });

  it('computes grouped service totals from nested labor and part rows', () => {
    expect(
      calculateServiceTotals({
        laborLines: [
          { description: 'Brake labor', hours: 2, rate: 100, discountPercent: 0 },
        ],
        partLines: [
          {
            name: 'Pads',
            quantity: 1,
            price: 85,
            cost: 55,
            discountPercent: 0,
          },
          {
            name: 'Rotor',
            quantity: 2,
            price: 110,
            cost: 90,
            discountPercent: 10,
          },
        ],
      }),
    ).toMatchObject({
      labor_total: 200,
      parts_total: 283,
      total: 483,
    });
  });

  it('computes the final estimate total with the default shop tax', () => {
    expect(
      calculateEstimateTotals([
        { labor_total: 200, parts_total: 50, total: 250 },
        { labor_total: 100, parts_total: 25, total: 125 },
      ]),
    ).toEqual({
      labor_total: 300,
      parts_total: 75,
      subtotal: 375,
      tax_rate: 8.875,
      tax_amount: 33.28,
      total: 408.28,
    });
  });

  it('resolves totals for legacy estimates without tax', () => {
    expect(
      resolveEstimateTotals({
        labor_total: 260,
        parts_total: 200,
        total: 460,
      }),
    ).toEqual({
      labor_total: 260,
      parts_total: 200,
      subtotal: 460,
      tax_rate: 0,
      tax_amount: 0,
      total: 460,
    });
  });

  it('resolves totals with applyDefaultTaxWhenMissing using the default shop tax', () => {
    expect(
      resolveEstimateTotals(
        {
          labor_total: 260,
          parts_total: 200,
          total: 460,
        },
        { applyDefaultTaxWhenMissing: true },
      ),
    ).toEqual({
      labor_total: 260,
      parts_total: 200,
      subtotal: 460,
      tax_rate: 8.875,
      tax_amount: 40.83,
      total: 500.83,
    });
  });

  it('derives tax from rate and adds it to the estimate total', () => {
    expect(
      resolveEstimateTotals({
        labor_total: 260,
        parts_total: 200,
        subtotal: 460,
        tax_rate: 8.875,
        total: 500.83,
      }),
    ).toEqual({
      labor_total: 260,
      parts_total: 200,
      subtotal: 460,
      tax_rate: 8.875,
      tax_amount: 40.83,
      total: 500.83,
    });
  });

  it('corrects legacy totals that equal subtotal by adding tax', () => {
    expect(
      resolveEstimateTotals({
        labor_total: 260,
        parts_total: 200,
        subtotal: 460,
        tax_rate: 8.875,
        tax_amount: 40.83,
        total: 460,
      }),
    ).toEqual({
      labor_total: 260,
      parts_total: 200,
      subtotal: 460,
      tax_rate: 8.875,
      tax_amount: 40.83,
      total: 500.83,
    });
  });

  it('preserves recorded overpayments while recomputing the remaining balance from tax-inclusive billing', () => {
    expect(
      resolveEstimatePaymentState({
        amount_paid: 500.83,
        total: 500.83,
        payment_status: 'PAID',
      }),
    ).toEqual({
      amount_paid: 500.83,
      amount_remaining: 0,
    });
  });

  it('has a default tax rate of 8.875 percent', () => {
    expect(DEFAULT_ESTIMATE_TAX_RATE_PERCENT).toBe(8.875);
  });

  it('rejects invalid discount values', () => {
    expect(() => calculateLaborSubtotal(1, 100, 101)).toThrow(
      'discountPercent must be between 0 and 100',
    );
  });
});
