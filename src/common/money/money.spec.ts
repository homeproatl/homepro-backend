import {
  dollarsToMinor,
  minorToDollars,
  percentToBasisPoints,
  basisPointsToPercent,
  unitsToQuantityMilli,
  quantityMilliToUnits,
  formatMoneyMinor,
  formatBasisPoints,
  formatQuantityMilli,
} from './money';

describe('money contracts', () => {
  it('stores dollars as integer minor units', () => {
    expect(dollarsToMinor(12.34)).toBe(1234);
    expect(minorToDollars(1234)).toBe(12.34);
    expect(formatMoneyMinor(1234)).toContain('12.34');
  });

  it('stores percentages as integer basis points (875 = 8.75%)', () => {
    expect(percentToBasisPoints(8.75)).toBe(875);
    expect(basisPointsToPercent(875)).toBe(8.75);
    expect(formatBasisPoints(875)).toBe('8.75%');
  });

  it('stores quantity as integer thousandths (1000 = 1.000)', () => {
    expect(unitsToQuantityMilli(1)).toBe(1000);
    expect(quantityMilliToUnits(1000)).toBe(1);
    expect(formatQuantityMilli(1000)).toBe('1.000');
  });
});
