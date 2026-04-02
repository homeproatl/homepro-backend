export type LaborLineInput = {
  description: string;
  assignedUserId?: string | null;
  hours: number;
  rate: number;
  discountPercent?: number;
};

export type PartLineInput = {
  name: string;
  quantity: number;
  cost?: number | null;
  price: number;
  discountPercent?: number;
};

export type CalculatedLaborLine = {
  description: string;
  assigned_user_id: string | null;
  hours: number;
  rate: number;
  discount_percent: number;
  subtotal: number;
};

export type CalculatedPartLine = {
  name: string;
  quantity: number;
  cost: number | null;
  price: number;
  discount_percent: number;
  subtotal: number;
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
  total: number;
};

function roundCurrency(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
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
      subtotal: calculateLaborSubtotal(line.hours, line.rate, discountPercent),
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
      quantity: line.quantity,
      cost: normalizedCost,
      price: line.price,
      discount_percent: discountPercent,
      subtotal: calculatePartSubtotal(
        line.quantity,
        line.price,
        discountPercent,
      ),
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

  return {
    labor_total,
    parts_total,
    total: roundCurrency(
      services.reduce((sum, service) => sum + service.total, 0),
    ),
  };
}
