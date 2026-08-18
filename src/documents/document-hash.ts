import { createHash } from 'crypto';

/**
 * Canonical JSON + SHA-256 hash of financial/customer fields that freeze when
 * an estimate goes pending or an invoice is issued.
 */
export function buildDocumentFrozenHash(doc: {
  type: string;
  number: string;
  client_id: unknown;
  po_number?: string | null;
  job_name?: string | null;
  service_address_snapshot?: unknown;
  issue_date?: Date | string | null;
  expiration_date?: Date | string | null;
  due_date?: Date | string | null;
  client_snapshot: unknown;
  company_snapshot: unknown;
  settings_snapshot: unknown;
  line_items: unknown[];
  subtotal_minor: number;
  markup_total_minor: number;
  discount_total_minor: number;
  tax_total_minor: number;
  deposit_requested_minor: number;
  total_minor: number;
  contract_template_id?: unknown;
  contract_snapshot?: string | null;
  customer_notes?: string | null;
}): string {
  const canonical = {
    type: doc.type,
    number: doc.number,
    client_id: asIdString(doc.client_id) ?? '',
    po_number: doc.po_number ?? null,
    job_name: doc.job_name ?? null,
    service_address_snapshot: canonicalize(
      doc.service_address_snapshot ?? null,
    ),
    issue_date: toIsoOrNull(doc.issue_date),
    expiration_date: toIsoOrNull(doc.expiration_date),
    due_date: toIsoOrNull(doc.due_date),
    client_snapshot: canonicalize(doc.client_snapshot),
    company_snapshot: canonicalize(doc.company_snapshot),
    settings_snapshot: canonicalize(doc.settings_snapshot),
    line_items: (doc.line_items ?? []).map((line) => canonicalize(line)),
    subtotal_minor: doc.subtotal_minor,
    markup_total_minor: doc.markup_total_minor,
    discount_total_minor: doc.discount_total_minor,
    tax_total_minor: doc.tax_total_minor,
    deposit_requested_minor: doc.deposit_requested_minor,
    total_minor: doc.total_minor,
    contract_template_id: asIdString(doc.contract_template_id),
    contract_snapshot: doc.contract_snapshot ?? null,
    customer_notes: doc.customer_notes ?? null,
  };

  return createHash('sha256')
    .update(stableStringify(canonical), 'utf8')
    .digest('hex');
}

function asIdString(value: unknown): string | null {
  if (value == null) {
    return null;
  }
  if (typeof value === 'string') {
    return value;
  }
  if (typeof value === 'object' && value !== null && 'toHexString' in value) {
    const toHex = (value as { toHexString?: () => string }).toHexString;
    if (typeof toHex === 'function') {
      return toHex.call(value);
    }
  }
  if (typeof value === 'object' && value !== null && 'toString' in value) {
    const text = (value as { toString: () => string }).toString();
    if (text && text !== '[object Object]') {
      return text;
    }
  }
  return null;
}

function toIsoOrNull(value: Date | string | null | undefined): string | null {
  if (value == null) {
    return null;
  }
  if (value instanceof Date) {
    return value.toISOString();
  }
  return String(value);
}

function canonicalize(value: unknown): unknown {
  if (value == null) {
    return null;
  }
  if (value instanceof Date) {
    return value.toISOString();
  }
  if (typeof value === 'object' && value !== null && '_bsontype' in value) {
    return asIdString(value) ?? null;
  }
  if (Array.isArray(value)) {
    return value.map((entry) => canonicalize(entry));
  }
  if (typeof value === 'object') {
    const record = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(record).sort()) {
      if (key === '__v' || key === 'toObject' || key === 'toJSON') {
        continue;
      }
      // Drop mongoose internals / calculated-only photo arrays stay.
      out[key] = canonicalize(record[key]);
    }
    return out;
  }
  return value;
}

function stableStringify(value: unknown): string {
  return JSON.stringify(value);
}
