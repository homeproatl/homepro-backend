/**
 * Authoritative document line/document calculators (Release 1).
 * Money: integer USD cents (minor). Rates: basis points. Qty: thousandths.
 * Rounding: half-away-from-zero at every money intermediate.
 *
 * Order per line: base subtotal → markup → discount → tax → total.
 * Waste adjusts internal purchase quantity/cost only (not customer qty/price).
 */
import {
  BASIS_POINTS_PER_WHOLE,
  QUANTITY_MILLI_PER_UNIT,
  assertSafeInteger,
  type BasisPoints,
  type MoneyMinor,
  type QuantityMilli,
} from '../money/money';

export type MarkupOrDiscountType = 'none' | 'percent' | 'fixed';

export type DocumentLineCalcInput = {
  rate_minor: MoneyMinor;
  quantity_milli: QuantityMilli;
  markup_type: MarkupOrDiscountType;
  /** Percent: basis points; fixed: money minor; none: ignored (must be 0). */
  markup_value: number;
  discount_type: MarkupOrDiscountType;
  discount_value: number;
  taxable: boolean;
  tax_rate_basis_points: BasisPoints;
  internal_unit_cost_minor?: MoneyMinor | null;
  waste_basis_points?: BasisPoints;
};

export type CalculatedDocumentLine = {
  subtotal_minor: MoneyMinor;
  markup_amount_minor: MoneyMinor;
  discount_amount_minor: MoneyMinor;
  tax_amount_minor: MoneyMinor;
  total_minor: MoneyMinor;
  adjusted_quantity_milli: QuantityMilli;
  internal_cost_total_minor: MoneyMinor;
};

export type DocumentTotalsInput = {
  lines: Array<
    Pick<
      CalculatedDocumentLine,
      | 'subtotal_minor'
      | 'markup_amount_minor'
      | 'discount_amount_minor'
      | 'tax_amount_minor'
      | 'total_minor'
    >
  >;
  deposit_requested_minor?: MoneyMinor;
  amount_paid_minor?: MoneyMinor;
  amount_refunded_minor?: MoneyMinor;
  amount_disputed_minor?: MoneyMinor;
};

export type CalculatedDocumentTotals = {
  subtotal_minor: MoneyMinor;
  markup_total_minor: MoneyMinor;
  discount_total_minor: MoneyMinor;
  tax_total_minor: MoneyMinor;
  total_minor: MoneyMinor;
  deposit_requested_minor: MoneyMinor;
  amount_paid_minor: MoneyMinor;
  amount_refunded_minor: MoneyMinor;
  amount_disputed_minor: MoneyMinor;
  balance_due_minor: MoneyMinor;
};

/** Half-away-from-zero integer rounding (documented Step 7 rule). */
export function roundHalfAwayFromZero(value: number): number {
  if (!Number.isFinite(value)) {
    throw new Error('value must be finite');
  }
  if (value >= 0) {
    return Math.floor(value + 0.5);
  }
  return Math.ceil(value - 0.5);
}

function assertNonNegativeSafeInt(value: number, label: string) {
  assertSafeInteger(value, label);
  if (value < 0) {
    throw new Error(`${label} must be >= 0`);
  }
}

function assertMarkupDiscount(
  type: MarkupOrDiscountType,
  value: number,
  label: string,
) {
  assertSafeInteger(value, label);
  if (type === 'none' && value !== 0) {
    throw new Error(`${label} must be 0 when type is none`);
  }
  if (value < 0) {
    throw new Error(`${label} must be >= 0`);
  }
}

function applyAdjustment(
  baseMinor: MoneyMinor,
  type: MarkupOrDiscountType,
  value: number,
): MoneyMinor {
  if (type === 'none') {
    return 0;
  }
  if (type === 'fixed') {
    return value;
  }
  // percent: value is basis points of whole (10_000 = 100%)
  return roundHalfAwayFromZero((baseMinor * value) / BASIS_POINTS_PER_WHOLE);
}

/**
 * Customer-facing line math. Waste does not change rate/quantity/price.
 */
export function calculateDocumentLine(
  input: DocumentLineCalcInput,
): CalculatedDocumentLine {
  assertNonNegativeSafeInt(input.rate_minor, 'rate_minor');
  assertNonNegativeSafeInt(input.quantity_milli, 'quantity_milli');
  if (input.quantity_milli <= 0) {
    throw new Error('quantity_milli must be > 0');
  }
  assertMarkupDiscount(input.markup_type, input.markup_value, 'markup_value');
  assertMarkupDiscount(
    input.discount_type,
    input.discount_value,
    'discount_value',
  );
  assertNonNegativeSafeInt(
    input.tax_rate_basis_points,
    'tax_rate_basis_points',
  );
  const waste = input.waste_basis_points ?? 0;
  assertNonNegativeSafeInt(waste, 'waste_basis_points');

  const subtotal_minor = roundHalfAwayFromZero(
    (input.rate_minor * input.quantity_milli) / QUANTITY_MILLI_PER_UNIT,
  );

  const markup_amount_minor = applyAdjustment(
    subtotal_minor,
    input.markup_type,
    input.markup_value,
  );
  const afterMarkup = subtotal_minor + markup_amount_minor;

  const discount_amount_minor = applyAdjustment(
    afterMarkup,
    input.discount_type,
    input.discount_value,
  );
  if (discount_amount_minor > afterMarkup) {
    throw new Error('discount cannot exceed amount after markup');
  }
  const afterDiscount = afterMarkup - discount_amount_minor;

  const tax_amount_minor = input.taxable
    ? roundHalfAwayFromZero(
        (afterDiscount * input.tax_rate_basis_points) / BASIS_POINTS_PER_WHOLE,
      )
    : 0;

  const total_minor = afterDiscount + tax_amount_minor;

  const wasteDelta = roundHalfAwayFromZero(
    (input.quantity_milli * waste) / BASIS_POINTS_PER_WHOLE,
  );
  const adjusted_quantity_milli = input.quantity_milli + wasteDelta;

  const unitCost = input.internal_unit_cost_minor ?? null;
  let internal_cost_total_minor = 0;
  if (unitCost != null) {
    assertNonNegativeSafeInt(unitCost, 'internal_unit_cost_minor');
    internal_cost_total_minor = roundHalfAwayFromZero(
      (unitCost * adjusted_quantity_milli) / QUANTITY_MILLI_PER_UNIT,
    );
  }

  return {
    subtotal_minor,
    markup_amount_minor,
    discount_amount_minor,
    tax_amount_minor,
    total_minor,
    adjusted_quantity_milli,
    internal_cost_total_minor,
  };
}

export function calculateDocumentTotals(
  input: DocumentTotalsInput,
): CalculatedDocumentTotals {
  const subtotal_minor = input.lines.reduce(
    (sum, line) => sum + line.subtotal_minor,
    0,
  );
  const markup_total_minor = input.lines.reduce(
    (sum, line) => sum + line.markup_amount_minor,
    0,
  );
  const discount_total_minor = input.lines.reduce(
    (sum, line) => sum + line.discount_amount_minor,
    0,
  );
  const tax_total_minor = input.lines.reduce(
    (sum, line) => sum + line.tax_amount_minor,
    0,
  );
  const total_minor = input.lines.reduce(
    (sum, line) => sum + line.total_minor,
    0,
  );

  const deposit_requested_minor = input.deposit_requested_minor ?? 0;
  const amount_paid_minor = input.amount_paid_minor ?? 0;
  const amount_refunded_minor = input.amount_refunded_minor ?? 0;
  const amount_disputed_minor = input.amount_disputed_minor ?? 0;

  assertNonNegativeSafeInt(deposit_requested_minor, 'deposit_requested_minor');
  assertNonNegativeSafeInt(amount_paid_minor, 'amount_paid_minor');
  assertNonNegativeSafeInt(amount_refunded_minor, 'amount_refunded_minor');
  assertNonNegativeSafeInt(amount_disputed_minor, 'amount_disputed_minor');

  if (deposit_requested_minor > total_minor) {
    throw new Error('deposit_requested_minor must be <= total_minor');
  }

  // Paid reduces balance; refunds and active disputes restore amount owed.
  // Cap at the document total so malformed/imported aggregates cannot create
  // an amount due greater than the invoice itself.
  const balance_due_minor = Math.min(
    total_minor,
    Math.max(
      0,
      total_minor -
        amount_paid_minor +
        amount_refunded_minor +
        amount_disputed_minor,
    ),
  );

  return {
    subtotal_minor,
    markup_total_minor,
    discount_total_minor,
    tax_total_minor,
    total_minor,
    deposit_requested_minor,
    amount_paid_minor,
    amount_refunded_minor,
    amount_disputed_minor,
    balance_due_minor,
  };
}
