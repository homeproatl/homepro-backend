/** Canonical money, percentage, and quantity storage contracts. */

export type MoneyMinor = number;
export type BasisPoints = number;
export type QuantityMilli = number;

export const BASIS_POINTS_PER_PERCENT = 100;
export const BASIS_POINTS_PER_WHOLE = 10_000;
export const QUANTITY_MILLI_PER_UNIT = 1_000;
export const MONEY_MINOR_PER_MAJOR = 100;

export function assertSafeInteger(
  value: number,
  label: string,
): asserts value is number {
  if (!Number.isSafeInteger(value)) {
    throw new Error(`${label} must be a safe integer`);
  }
}

export function dollarsToMinor(dollars: number): MoneyMinor {
  if (!Number.isFinite(dollars)) {
    throw new Error('dollars must be finite');
  }
  const minor = Math.round(dollars * MONEY_MINOR_PER_MAJOR);
  assertSafeInteger(minor, 'money minor');
  return minor;
}

export function minorToDollars(minor: MoneyMinor): number {
  assertSafeInteger(minor, 'money minor');
  return minor / MONEY_MINOR_PER_MAJOR;
}

export function percentToBasisPoints(percent: number): BasisPoints {
  if (!Number.isFinite(percent)) {
    throw new Error('percent must be finite');
  }
  const bps = Math.round(percent * BASIS_POINTS_PER_PERCENT);
  assertSafeInteger(bps, 'basis points');
  return bps;
}

export function basisPointsToPercent(bps: BasisPoints): number {
  assertSafeInteger(bps, 'basis points');
  return bps / BASIS_POINTS_PER_PERCENT;
}

export function unitsToQuantityMilli(units: number): QuantityMilli {
  if (!Number.isFinite(units)) {
    throw new Error('quantity units must be finite');
  }
  const milli = Math.round(units * QUANTITY_MILLI_PER_UNIT);
  assertSafeInteger(milli, 'quantity milli');
  return milli;
}

export function quantityMilliToUnits(milli: QuantityMilli): number {
  assertSafeInteger(milli, 'quantity milli');
  return milli / QUANTITY_MILLI_PER_UNIT;
}

export function formatMoneyMinor(minor: MoneyMinor, currency = 'USD'): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency,
  }).format(minorToDollars(minor));
}

export function formatBasisPoints(bps: BasisPoints): string {
  const percent = basisPointsToPercent(bps);
  return `${percent.toFixed(2)}%`;
}

export function formatQuantityMilli(milli: QuantityMilli): string {
  return quantityMilliToUnits(milli).toFixed(3);
}
