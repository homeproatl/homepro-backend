export type PartLine = {
  quantity: number;
  unitPrice: number;
};

export type ServiceLine = {
  quantity: number;
  unitPriceSnapshot: number;
};

function roundCurrency(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function validateNonNegativeNumber(name: string, value: number) {
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`${name} must be a non-negative number`);
  }
}

function validatePositiveQuantity(quantity: number) {
  if (!Number.isFinite(quantity) || quantity <= 0) {
    throw new Error('quantity must be a positive number');
  }
}

export function calculatePartSubtotal(
  quantity: number,
  unitPrice: number,
): number {
  validatePositiveQuantity(quantity);
  validateNonNegativeNumber('unitPrice', unitPrice);
  return roundCurrency(quantity * unitPrice);
}

export function calculateServiceSubtotal(
  quantity: number,
  unitPriceSnapshot: number,
): number {
  validatePositiveQuantity(quantity);
  validateNonNegativeNumber('unitPriceSnapshot', unitPriceSnapshot);
  return roundCurrency(quantity * unitPriceSnapshot);
}

export function calculatePartsTotal(parts: PartLine[]): number {
  return roundCurrency(
    parts.reduce(
      (sum, part) => sum + calculatePartSubtotal(part.quantity, part.unitPrice),
      0,
    ),
  );
}

export function calculateServicesTotal(services: ServiceLine[]): number {
  return roundCurrency(
    services.reduce(
      (sum, service) =>
        sum +
        calculateServiceSubtotal(service.quantity, service.unitPriceSnapshot),
      0,
    ),
  );
}

export function calculateJobBillableTotal(input: {
  partsBillableTotal: number;
  servicesBillableTotal: number;
  additionalCharges?: number;
}): number {
  validateNonNegativeNumber('partsBillableTotal', input.partsBillableTotal);
  validateNonNegativeNumber(
    'servicesBillableTotal',
    input.servicesBillableTotal,
  );
  validateNonNegativeNumber('additionalCharges', input.additionalCharges ?? 0);

  return roundCurrency(
    input.partsBillableTotal +
      input.servicesBillableTotal +
      (input.additionalCharges ?? 0),
  );
}
