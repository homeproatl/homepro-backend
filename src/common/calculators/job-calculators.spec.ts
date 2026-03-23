import {
  calculateJobBillableTotal,
  calculatePartSubtotal,
  calculatePartsTotal,
  calculateServiceSubtotal,
  calculateServicesTotal,
} from './job-calculators';

describe('job calculators', () => {
  it('computes line subtotals deterministically', () => {
    expect(calculatePartSubtotal(2, 12.345)).toBe(24.69);
    expect(calculateServiceSubtotal(3, 99.995)).toBe(299.99);
  });

  it('computes parts and services totals from line arrays', () => {
    expect(
      calculatePartsTotal([
        { quantity: 2, unitPrice: 10 },
        { quantity: 1, unitPrice: 2.5 },
      ]),
    ).toBe(22.5);

    expect(
      calculateServicesTotal([
        { quantity: 2, unitPriceSnapshot: 50 },
        { quantity: 1, unitPriceSnapshot: 25 },
      ]),
    ).toBe(125);
  });

  it('computes the final job total', () => {
    expect(
      calculateJobBillableTotal({
        partsBillableTotal: 22.5,
        servicesBillableTotal: 125,
        additionalCharges: 10,
      }),
    ).toBe(157.5);
  });

  it('rejects negative values', () => {
    expect(() =>
      calculateJobBillableTotal({
        partsBillableTotal: -1,
        servicesBillableTotal: 10,
      }),
    ).toThrow('partsBillableTotal must be a non-negative number');
  });
});
