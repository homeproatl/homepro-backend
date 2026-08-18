import {
  calculateDocumentLine,
  calculateDocumentTotals,
  roundHalfAwayFromZero,
} from './document-calculators';
import { percentToBasisPoints, unitsToQuantityMilli } from '../money/money';

describe('document-calculators', () => {
  it('rounds half away from zero', () => {
    expect(roundHalfAwayFromZero(2.5)).toBe(3);
    expect(roundHalfAwayFromZero(-2.5)).toBe(-3);
    expect(roundHalfAwayFromZero(2.4)).toBe(2);
  });

  it('computes line base → markup → discount → tax with shared fixtures', () => {
    // $100.00 rate × 2.000 qty = $200.00
    // 10% markup = $20.00 → $220.00
    // 5% discount = $11.00 → $209.00
    // 8.875% tax ≈ $18.55 → $227.55
    const line = calculateDocumentLine({
      rate_minor: 10_000,
      quantity_milli: unitsToQuantityMilli(2),
      markup_type: 'percent',
      markup_value: percentToBasisPoints(10),
      discount_type: 'percent',
      discount_value: percentToBasisPoints(5),
      taxable: true,
      tax_rate_basis_points: percentToBasisPoints(8.875),
      internal_unit_cost_minor: 4_000,
      waste_basis_points: percentToBasisPoints(10),
    });

    expect(line.subtotal_minor).toBe(20_000);
    expect(line.markup_amount_minor).toBe(2_000);
    expect(line.discount_amount_minor).toBe(1_100);
    // 8.875% → 888 bps; 20900 * 888 / 10000 = 1855.92 → 1856
    expect(line.tax_amount_minor).toBe(1_856);
    expect(line.total_minor).toBe(22_756);
    // waste 10% on qty 2000 → adjusted 2200; cost $40 × 2.2 = $88
    expect(line.adjusted_quantity_milli).toBe(2_200);
    expect(line.internal_cost_total_minor).toBe(8_800);
  });

  it('does not let waste change customer quantity or price', () => {
    const withoutWaste = calculateDocumentLine({
      rate_minor: 1_000,
      quantity_milli: 1_000,
      markup_type: 'none',
      markup_value: 0,
      discount_type: 'none',
      discount_value: 0,
      taxable: false,
      tax_rate_basis_points: 0,
      internal_unit_cost_minor: 500,
      waste_basis_points: 0,
    });
    const withWaste = calculateDocumentLine({
      rate_minor: 1_000,
      quantity_milli: 1_000,
      markup_type: 'none',
      markup_value: 0,
      discount_type: 'none',
      discount_value: 0,
      taxable: false,
      tax_rate_basis_points: 0,
      internal_unit_cost_minor: 500,
      waste_basis_points: percentToBasisPoints(25),
    });

    expect(withWaste.subtotal_minor).toBe(withoutWaste.subtotal_minor);
    expect(withWaste.total_minor).toBe(withoutWaste.total_minor);
    expect(withWaste.adjusted_quantity_milli).toBe(1_250);
    expect(withWaste.internal_cost_total_minor).toBe(625);
  });

  it('sums document totals and enforces deposit bounds', () => {
    const line = calculateDocumentLine({
      rate_minor: 5_000,
      quantity_milli: 1_000,
      markup_type: 'none',
      markup_value: 0,
      discount_type: 'none',
      discount_value: 0,
      taxable: false,
      tax_rate_basis_points: 0,
    });
    const totals = calculateDocumentTotals({
      lines: [line, line],
      deposit_requested_minor: 2_000,
      amount_paid_minor: 1_000,
      amount_refunded_minor: 0,
    });

    expect(totals.subtotal_minor).toBe(10_000);
    expect(totals.total_minor).toBe(10_000);
    expect(totals.balance_due_minor).toBe(9_000);
    expect(totals.deposit_requested_minor).toBe(2_000);

    expect(() =>
      calculateDocumentTotals({
        lines: [line],
        deposit_requested_minor: 9_999,
      }),
    ).toThrow(/deposit/i);
  });

  it('restores disputed funds to the balance without exceeding the total', () => {
    const line = calculateDocumentLine({
      rate_minor: 10_000,
      quantity_milli: 1_000,
      markup_type: 'none',
      markup_value: 0,
      discount_type: 'none',
      discount_value: 0,
      taxable: false,
      tax_rate_basis_points: 0,
    });

    expect(
      calculateDocumentTotals({
        lines: [line],
        amount_paid_minor: 10_000,
        amount_disputed_minor: 4_000,
      }).balance_due_minor,
    ).toBe(4_000);
    expect(
      calculateDocumentTotals({
        lines: [line],
        amount_paid_minor: 1_000,
        amount_refunded_minor: 1_000,
        amount_disputed_minor: 1_000,
      }).balance_due_minor,
    ).toBe(10_000);
  });

  it('rejects none markup with non-zero value', () => {
    expect(() =>
      calculateDocumentLine({
        rate_minor: 100,
        quantity_milli: 1_000,
        markup_type: 'none',
        markup_value: 1,
        discount_type: 'none',
        discount_value: 0,
        taxable: false,
        tax_rate_basis_points: 0,
      }),
    ).toThrow(/markup_value/);
  });
});
