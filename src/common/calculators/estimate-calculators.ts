import { type TagColor } from '../../tags/tag-colors';
import { type TagScope } from '../../tags/tag-scopes';

export type LineTagInput = {
  id?: string | null;
  scope: TagScope;
  name: string;
  color: TagColor;
};

export type CalculatedLineTag = {
  tag_id: string | null;
  scope: TagScope;
  name: string;
  color: TagColor;
};

export type LaborLineInput = {
  description: string;
  assignedUserId?: string | null;
  hours: number;
  rate: number;
  discountPercent?: number;
  isCompleted?: boolean;
  tags?: Array<LineTagInput | CalculatedLineTag>;
};

export type PartLineInput = {
  name: string;
  partNumber?: string | null;
  quantity: number;
  cost?: number | null;
  price: number;
  discountPercent?: number;
  tags?: Array<LineTagInput | CalculatedLineTag>;
};

export type CalculatedLaborLine = {
  description: string;
  assigned_user_id: string | null;
  hours: number;
  rate: number;
  discount_percent: number;
  is_completed: boolean;
  subtotal: number;
  tags: CalculatedLineTag[];
};

export type CalculatedPartLine = {
  name: string;
  part_number: string | null;
  quantity: number;
  cost: number | null;
  price: number;
  discount_percent: number;
  subtotal: number;
  tags: CalculatedLineTag[];
};

export type CalculatedServiceTotals = {
  labor_lines: CalculatedLaborLine[];
  part_lines: CalculatedPartLine[];
  labor_total: number;
  parts_total: number;
  total: number;
};

export type CalculatedEstimateTotals = {
  labor_total: number;
  parts_total: number;
  subtotal: number;
  tax_rate: number;
  tax_amount: number;
  total: number;
};

export type CalculatedEstimatePaymentState = {
  amount_paid: number;
  amount_remaining: number;
};

export const DEFAULT_ESTIMATE_TAX_RATE_PERCENT = 8.875;

function roundCurrency(value: number): number {
  return Number((value + 1e-9).toFixed(2));
}

function normalizeCurrencyValue(value: number | undefined) {
  if (!Number.isFinite(value) || (value ?? 0) < 0) {
    return null;
  }

  return roundCurrency(value ?? 0);
}

function normalizeTaxRate(value: number | undefined) {
  if (!Number.isFinite(value) || (value ?? 0) < 0) {
    return DEFAULT_ESTIMATE_TAX_RATE_PERCENT;
  }

  return Math.round(((value ?? DEFAULT_ESTIMATE_TAX_RATE_PERCENT) + Number.EPSILON) * 1000) / 1000;
}

function validateNonNegativeNumber(name: string, value: number) {
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`${name} must be a non-negative number`);
  }
}

function validatePositiveQuantity(name: string, quantity: number) {
  if (!Number.isFinite(quantity) || quantity <= 0) {
    throw new Error(`${name} must be greater than zero`);
  }
}

function validateDiscountPercent(discountPercent: number) {
  if (
    !Number.isFinite(discountPercent) ||
    discountPercent < 0 ||
    discountPercent > 100
  ) {
    throw new Error('discountPercent must be between 0 and 100');
  }
}

function resolveCalculatedTagId(tag: LineTagInput | CalculatedLineTag) {
  if ('tag_id' in tag) {
    return tag.tag_id;
  }

  return tag.id ?? null;
}

export function calculateLaborSubtotal(
  hours: number,
  rate: number,
  discountPercent = 0,
): number {
  validateNonNegativeNumber('hours', hours);
  validateNonNegativeNumber('rate', rate);
  validateDiscountPercent(discountPercent);

  return roundCurrency(hours * rate * (1 - discountPercent / 100));
}

export function calculatePartSubtotal(
  quantity: number,
  price: number,
  discountPercent = 0,
): number {
  validatePositiveQuantity('quantity', quantity);
  validateNonNegativeNumber('price', price);
  validateDiscountPercent(discountPercent);

  return roundCurrency(quantity * price * (1 - discountPercent / 100));
}

export function calculateServiceTotals(input: {
  laborLines: LaborLineInput[];
  partLines: PartLineInput[];
}): CalculatedServiceTotals {
  const labor_lines = input.laborLines.map((line) => {
    const discountPercent = line.discountPercent ?? 0;
    return {
      description: line.description.trim(),
      assigned_user_id: line.assignedUserId ?? null,
      hours: line.hours,
      rate: line.rate,
      discount_percent: discountPercent,
      is_completed: line.isCompleted ?? false,
      subtotal: calculateLaborSubtotal(line.hours, line.rate, discountPercent),
      tags: (line.tags ?? []).map((tag) => ({
        tag_id: resolveCalculatedTagId(tag),
        scope: tag.scope,
        name: tag.name.trim(),
        color: tag.color,
      })),
    };
  });

  const part_lines = input.partLines.map((line) => {
    const discountPercent = line.discountPercent ?? 0;
    const normalizedCost =
      line.cost === undefined || line.cost === null ? null : line.cost;

    if (normalizedCost !== null) {
      validateNonNegativeNumber('cost', normalizedCost);
    }

    return {
      name: line.name.trim(),
      part_number:
        typeof line.partNumber === 'string' && line.partNumber.trim().length > 0
          ? line.partNumber.trim()
          : null,
      quantity: line.quantity,
      cost: normalizedCost,
      price: line.price,
      discount_percent: discountPercent,
      subtotal: calculatePartSubtotal(
        line.quantity,
        line.price,
        discountPercent,
      ),
      tags: (line.tags ?? []).map((tag) => ({
        tag_id: resolveCalculatedTagId(tag),
        scope: tag.scope,
        name: tag.name.trim(),
        color: tag.color,
      })),
    };
  });

  const labor_total = roundCurrency(
    labor_lines.reduce((sum, line) => sum + line.subtotal, 0),
  );
  const parts_total = roundCurrency(
    part_lines.reduce((sum, line) => sum + line.subtotal, 0),
  );

  return {
    labor_lines,
    part_lines,
    labor_total,
    parts_total,
    total: roundCurrency(labor_total + parts_total),
  };
}

export function calculateEstimateTotals(
  services: Array<Pick<CalculatedServiceTotals, 'labor_total' | 'parts_total' | 'total'>>,
): CalculatedEstimateTotals {
  const labor_total = roundCurrency(
    services.reduce((sum, service) => sum + service.labor_total, 0),
  );
  const parts_total = roundCurrency(
    services.reduce((sum, service) => sum + service.parts_total, 0),
  );
  const subtotal = roundCurrency(
    services.reduce((sum, service) => sum + service.total, 0),
  );
  const tax_rate = DEFAULT_ESTIMATE_TAX_RATE_PERCENT;
  const tax_amount = roundCurrency(subtotal * (tax_rate / 100));

  return {
    labor_total,
    parts_total,
    subtotal,
    tax_rate,
    tax_amount,
    total: roundCurrency(subtotal + tax_amount),
  };
}

export function resolveEstimateTotals(input: {
  labor_total?: number;
  parts_total?: number;
  subtotal?: number;
  tax_rate?: number;
  tax_amount?: number;
  total?: number;
}, options?: { applyDefaultTaxWhenMissing?: boolean }): CalculatedEstimateTotals {
  const labor_total = normalizeCurrencyValue(input.labor_total) ?? 0;
  const parts_total = normalizeCurrencyValue(input.parts_total) ?? 0;
  const fallbackSubtotal = roundCurrency(labor_total + parts_total);
  const subtotal =
    normalizeCurrencyValue(input.subtotal) ?? fallbackSubtotal;
  const resolvedSubtotal = subtotal > 0 ? subtotal : fallbackSubtotal;
  const tax_rate =
    typeof input.tax_rate === 'number' && Number.isFinite(input.tax_rate)
      ? normalizeTaxRate(input.tax_rate)
      : options?.applyDefaultTaxWhenMissing
        ? DEFAULT_ESTIMATE_TAX_RATE_PERCENT
        : 0;
  const providedTaxAmount = normalizeCurrencyValue(input.tax_amount);
  const providedTotal = normalizeCurrencyValue(input.total);
  const calculatedTaxAmount = roundCurrency(resolvedSubtotal * (tax_rate / 100));
  const tax_amount =
    providedTaxAmount !== null &&
    (providedTaxAmount > 0 || tax_rate === 0 || resolvedSubtotal === 0)
      ? providedTaxAmount
      : tax_rate > 0
        ? calculatedTaxAmount
        : providedTotal !== null && providedTotal > resolvedSubtotal
          ? roundCurrency(providedTotal - resolvedSubtotal)
          : 0;
  const total = roundCurrency(resolvedSubtotal + tax_amount);

  return {
    labor_total,
    parts_total,
    subtotal: resolvedSubtotal,
    tax_rate,
    tax_amount,
    total,
  };
}

export function resolveEstimatePaymentState(input: {
  amount_paid?: number | null;
  total?: number | null;
  payment_status?: string | null;
}): CalculatedEstimatePaymentState {
  const total = normalizeCurrencyValue(input.total ?? undefined) ?? 0;
  const fallbackAmountPaid = input.payment_status === 'PAID' ? total : 0;
  const amount_paid =
    normalizeCurrencyValue(input.amount_paid ?? undefined) ??
    fallbackAmountPaid;

  return {
    amount_paid,
    amount_remaining: roundCurrency(Math.max(total - amount_paid, 0)),
  };
}
