import { createHash } from 'node:crypto';
import { parse } from 'csv-parse/sync';

export const JOIST_ENTITY_TYPES = [
  'client',
  'item',
  'estimate_summary',
  'invoice_summary',
] as const;
export type JoistEntityType = (typeof JOIST_ENTITY_TYPES)[number];

export type JoistImportRow = {
  entity_type: JoistEntityType;
  source_id: string | null;
  source_key: string;
  source_row_number: number;
  raw_values: Record<string, string>;
  raw_sha256: string;
  normalized_data: Record<string, unknown>;
  validation_errors: string[];
  validation_warnings: string[];
};

export type ParsedJoistCsv = {
  entity_type: JoistEntityType;
  headers: string[];
  rows: JoistImportRow[];
};

function asStringRecord(value: unknown): Record<string, string> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('CSV row must be an object.');
  }
  const record: Record<string, string> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (typeof entry !== 'string') {
      throw new Error(`CSV value for "${key}" must be text.`);
    }
    record[key] = entry;
  }
  return record;
}

function asStringArray(value: unknown): string[] {
  if (
    !Array.isArray(value) ||
    value.some((entry) => typeof entry !== 'string')
  ) {
    throw new Error('CSV header row must contain text columns.');
  }
  return value as string[];
}

const CLIENT_ID = '**(Do not change this) Joist Client ID';
const ITEM_ID = '**(Do not change this) Joist Item ID';
const ESTIMATE_NUMBER = 'Estimate #';
const INVOICE_NUMBER = 'Invoice #';
const DOCUMENT_FIXED_HEADERS = new Set([
  ESTIMATE_NUMBER,
  INVOICE_NUMBER,
  'Client Name',
  'Subtotal',
  'Total',
  'Date Issued',
  'Date Created',
  'Payment Received Less Refunds',
]);

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function nullable(value: unknown): string | null {
  const result = text(value);
  return result.length > 0 ? result : null;
}

export function normalizeJoistName(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

/** Parse decimal currency without binary floating-point drift. */
export function parseMoneyDecimal(value: string): {
  minor: number;
  exact_decimal: string;
  had_subcent_precision: boolean;
} {
  const cleaned = value.trim().replace(/[$,]/g, '');
  const match = cleaned.match(/^(-?)(\d+)(?:\.(\d+))?$/);
  if (!match) {
    throw new Error(`Invalid money value: ${value}`);
  }
  const negative = match[1] === '-';
  const whole = BigInt(match[2]);
  const fraction = match[3] ?? '';
  const cents = BigInt((fraction + '00').slice(0, 2));
  const thirdDigit = Number(fraction[2] ?? '0');
  let minor = whole * 100n + cents;
  if (thirdDigit >= 5) {
    minor += 1n;
  }
  if (negative) {
    minor *= -1n;
  }
  if (
    minor > BigInt(Number.MAX_SAFE_INTEGER) ||
    minor < BigInt(Number.MIN_SAFE_INTEGER)
  ) {
    throw new Error(`Money value exceeds safe storage range: ${value}`);
  }
  return {
    minor: Number(minor),
    exact_decimal: cleaned,
    had_subcent_precision:
      fraction.length > 2 && /[1-9]/.test(fraction.slice(2)),
  };
}

function parseOptionalMoney(value: string, field: string, errors: string[]) {
  try {
    return parseMoneyDecimal(value || '0');
  } catch {
    errors.push(`${field} is not a valid money value.`);
    return { minor: 0, exact_decimal: value, had_subcent_precision: false };
  }
}

function detectEntity(headers: string[]): JoistEntityType {
  if (headers.includes(CLIENT_ID)) return 'client';
  if (headers.includes(ITEM_ID)) return 'item';
  if (headers.includes(ESTIMATE_NUMBER)) return 'estimate_summary';
  if (headers.includes(INVOICE_NUMBER)) return 'invoice_summary';
  throw new Error(
    'Unsupported Joist CSV headers. Expected a Clients, Items, Estimates, or Invoices export.',
  );
}

function sourceKey(entity: JoistEntityType, row: Record<string, string>) {
  if (entity === 'client') return text(row[CLIENT_ID]);
  if (entity === 'item') return text(row[ITEM_ID]);
  const number = text(
    row[entity === 'estimate_summary' ? ESTIMATE_NUMBER : INVOICE_NUMBER],
  );
  return `${number}::${text(row['Date Created']) || text(row['Date Issued'])}`;
}

function rawHash(row: Record<string, string>) {
  return createHash('sha256').update(JSON.stringify(row)).digest('hex');
}

function parseClient(
  row: Record<string, string>,
  errors: string[],
  warnings: string[],
) {
  const displayName = text(row.Name);
  const sourceId = text(row[CLIENT_ID]);
  if (!displayName) errors.push('Name is required.');
  if (!sourceId) errors.push('Joist Client ID is required.');

  const email = nullable(row['Email Address']);
  if (email && !/^\S+@\S+\.\S+$/.test(email))
    warnings.push('Email address has an unusual format.');
  for (const [label, value] of [
    ['mobile phone', nullable(row['Phone (mobile)'])],
    ['other phone', nullable(row['Phone (other)'])],
  ] as const) {
    if (value && value.replace(/\D/g, '').length < 7) {
      warnings.push(`${label} has fewer than seven digits and needs review.`);
    }
  }

  const address = {
    street: nullable(row.Address),
    suite: nullable(row['Address 2']),
    city: nullable(row.City),
    state: nullable(row['State / Province']),
    postal_code: nullable(row['Zip / Postal Code']),
    country: null,
  };
  const hasAddress = Object.values(address).some((value) => value != null);
  return {
    source_id: sourceId || null,
    display_name: displayName,
    email: email?.toLowerCase() ?? null,
    phone: nullable(row['Phone (mobile)']),
    secondary_phone: nullable(row['Phone (other)']),
    billing_address: hasAddress ? address : null,
    service_addresses: hasAddress ? [address] : [],
    notes: nullable(row['Private Notes']),
  };
}

function parseItem(
  row: Record<string, string>,
  errors: string[],
  warnings: string[],
) {
  const name = text(row.Name);
  const sourceId = text(row[ITEM_ID]);
  if (!name) errors.push('Name is required.');
  if (!sourceId) errors.push('Joist Item ID is required.');
  const price = parseOptionalMoney(text(row.Price), 'Price', errors);
  if (price.minor < 0) errors.push('Price cannot be negative.');
  if (price.had_subcent_precision) {
    warnings.push(
      'Price has sub-cent precision; rounded cents and the exact source decimal are both retained.',
    );
  }
  return {
    source_id: sourceId || null,
    name,
    normalized_name: normalizeJoistName(name),
    description_template: nullable(row.Notes),
    default_rate_minor: Math.max(0, price.minor),
    source_rate_decimal: price.exact_decimal,
    item_type: 'service',
    taxable_default: false,
    tax_configuration_state: 'not_exported',
  };
}

function parseDocumentSummary(
  entity: 'estimate_summary' | 'invoice_summary',
  row: Record<string, string>,
  headers: string[],
  errors: string[],
  warnings: string[],
) {
  const numberHeader =
    entity === 'estimate_summary' ? ESTIMATE_NUMBER : INVOICE_NUMBER;
  const number = text(row[numberHeader]);
  if (!number) errors.push(`${numberHeader} is required.`);
  const subtotal = parseOptionalMoney(text(row.Subtotal), 'Subtotal', errors);
  const total = parseOptionalMoney(text(row.Total), 'Total', errors);
  const payment = parseOptionalMoney(
    entity === 'invoice_summary'
      ? text(row['Payment Received Less Refunds'])
      : '0',
    'Payment Received Less Refunds',
    errors,
  );
  const taxBreakdown = headers
    .filter((header) => !DOCUMENT_FIXED_HEADERS.has(header))
    .map((header) => ({
      name: header,
      amount_minor: parseOptionalMoney(text(row[header]), header, errors).minor,
      source_decimal: text(row[header]) || '0',
    }));
  const taxTotal = taxBreakdown.reduce((sum, tax) => sum + tax.amount_minor, 0);
  const unexplainedAdjustment = total.minor - subtotal.minor - taxTotal;
  if (unexplainedAdjustment !== 0) {
    warnings.push(
      `Export total differs from subtotal plus named taxes by ${unexplainedAdjustment} cents; source total remains authoritative.`,
    );
  }
  warnings.push(
    'Summary export has no line items; keep read-only until detailed document data is recovered.',
  );
  return {
    source_id: null,
    number,
    client_name: text(row['Client Name']),
    normalized_client_name: normalizeJoistName(text(row['Client Name'])),
    subtotal_minor: subtotal.minor,
    source_subtotal_decimal: subtotal.exact_decimal,
    tax_breakdown: taxBreakdown,
    tax_total_minor: taxTotal,
    unexplained_adjustment_minor: unexplainedAdjustment,
    total_minor: total.minor,
    source_total_decimal: total.exact_decimal,
    payment_received_minor: payment.minor,
    source_payment_received_decimal: payment.exact_decimal,
    issue_date: nullable(row['Date Issued']),
    source_created_at: nullable(row['Date Created']),
    migration_state: 'imported_summary',
  };
}

export function parseJoistCsv(content: string): ParsedJoistCsv {
  const records = parse(content, {
    bom: true,
    columns: true,
    skip_empty_lines: true,
    relax_column_count: false,
  });
  const headerRows: unknown[] = parse(content, { bom: true, to_line: 1 });
  const headers = asStringArray(headerRows[0]);
  const entityType = detectEntity(headers);
  const rows = records.map((rawRow, index): JoistImportRow => {
    const row = asStringRecord(rawRow);
    const validationErrors: string[] = [];
    const validationWarnings: string[] = [];
    const normalizedData =
      entityType === 'client'
        ? parseClient(row, validationErrors, validationWarnings)
        : entityType === 'item'
          ? parseItem(row, validationErrors, validationWarnings)
          : parseDocumentSummary(
              entityType,
              row,
              headers,
              validationErrors,
              validationWarnings,
            );
    const key = sourceKey(entityType, row);
    if (!key)
      validationErrors.push('A stable source key could not be created.');
    return {
      entity_type: entityType,
      source_id: normalizedData.source_id ?? null,
      source_key: key,
      source_row_number: index + 2,
      raw_values: row,
      raw_sha256: rawHash(row),
      normalized_data: normalizedData,
      validation_errors: validationErrors,
      validation_warnings: validationWarnings,
    };
  });
  return { entity_type: entityType, headers, rows };
}
