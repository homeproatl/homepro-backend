import {
  calculateEstimateTotals,
  calculateLaborSubtotal,
  calculatePartSubtotal,
  calculateServiceTotals,
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

  it('computes the final estimate total from grouped service totals', () => {
    expect(
      calculateEstimateTotals([
        { labor_total: 200, parts_total: 50, total: 250 },
        { labor_total: 100, parts_total: 25, total: 125 },
      ]),
    ).toEqual({
      labor_total: 300,
      parts_total: 75,
      total: 375,
    });
  });

  it('rejects invalid discount values', () => {
    expect(() => calculateLaborSubtotal(1, 100, 101)).toThrow(
      'discountPercent must be between 0 and 100',
    );
  });
});
