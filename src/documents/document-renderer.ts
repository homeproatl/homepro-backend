/**
 * Allowlisted customer-facing document renderer model.
 * Used by admin preview, public page, email, and PDF.
 * Never include private notes, internal costs, vendor, purchase status, waste,
 * adjusted purchase qty, admin IDs, tokens, or audit metadata.
 */

export type RendererAddress = {
  street: string | null;
  suite: string | null;
  city: string | null;
  state: string | null;
  postal_code: string | null;
  country: string | null;
};

export type DocumentRendererLineItem = {
  sort_order: number;
  line_type: string;
  description: string;
  notes: string | null;
  unit_of_measure: string | null;
  quantity_milli: number;
  rate_minor: number;
  markup_amount_minor: number;
  discount_amount_minor: number;
  tax_amount_minor: number;
  subtotal_minor: number;
  total_minor: number;
  photo_assets: DocumentRendererAsset[];
};

export type DocumentRendererAsset = {
  asset_id: string;
  label: string;
  kind: 'photo' | 'attachment';
};

export type DocumentRendererModel = {
  document_type: 'estimate' | 'invoice';
  number: string;
  po_number: string | null;
  status: string;
  issue_date: string | null;
  expiration_date: string | null;
  due_date: string | null;
  job_name: string | null;
  service_address: RendererAddress | null;
  company: {
    display_name: string;
    legal_name: string | null;
    phone: string | null;
    email: string | null;
    website: string | null;
    address: RendererAddress | null;
    license_number: string | null;
  };
  client: {
    display_name: string;
    company_name: string | null;
    email: string | null;
    phone: string | null;
    billing_address: RendererAddress | null;
  };
  line_items: DocumentRendererLineItem[];
  document_photos: DocumentRendererAsset[];
  attachments: DocumentRendererAsset[];
  customer_notes: string | null;
  contract_body: string | null;
  show_client_signature: boolean;
  show_company_signature: boolean;
  client_signature: {
    signer_name: string;
    signed_at: string;
  } | null;
  totals: {
    subtotal_minor: number;
    markup_total_minor: number;
    discount_total_minor: number;
    tax_total_minor: number;
    deposit_requested_minor: number;
    total_minor: number;
    payments_applied_minor: number;
    amount_due_minor: number;
  };
  frozen_revision_number: number | null;
  currency: 'usd';
};

/** Keys that must never appear anywhere in customer-facing renderer output. */
export const DOCUMENT_RENDERER_FORBIDDEN_KEYS = [
  'private_notes',
  'internal_unit_cost_minor',
  'internal_cost_total_minor',
  'vendor_name',
  'purchase_status',
  'waste_basis_points',
  'adjusted_quantity_milli',
  'sku_or_part_number',
  'organization_id',
  'client_id',
  'item_id',
  'tax_id',
  'contract_template_id',
  'amount_paid_minor',
  'amount_refunded_minor',
  'amount_disputed_minor',
  'balance_due_minor',
  'token',
  'token_hash',
  'access_grant',
  'share_url',
  'mongo',
  '_id',
  'actor',
  'user_id',
  'margin',
  'gross_margin',
  'frozen_hash',
  'document_hash',
] as const;

export type DocumentRendererSource = {
  type: 'estimate' | 'invoice';
  number: string;
  po_number?: string | null;
  status: string;
  issue_date?: string | Date | null;
  expiration_date?: string | Date | null;
  due_date?: string | Date | null;
  job_name?: string | null;
  service_address_snapshot?: RendererAddress | null;
  company_snapshot?: {
    display_name?: string;
    legal_name?: string | null;
    phone?: string | null;
    email?: string | null;
    website?: string | null;
    address?: RendererAddress | null;
    license_number?: string | null;
  } | null;
  client_snapshot?: {
    display_name?: string;
    company_name?: string | null;
    email?: string | null;
    phone?: string | null;
    billing_address?: RendererAddress | null;
  } | null;
  line_items?: Array<{
    sort_order?: number;
    line_type?: string;
    description?: string;
    notes?: string | null;
    unit_of_measure?: string | null;
    quantity_milli?: number;
    rate_minor?: number;
    markup_amount_minor?: number;
    discount_amount_minor?: number;
    tax_amount_minor?: number;
    subtotal_minor?: number;
    total_minor?: number;
    photo_asset_ids?: unknown[];
  }>;
  document_photo_asset_ids?: unknown[];
  attachment_asset_ids?: unknown[];
  document_photo_metadata?: Array<{
    asset_id?: unknown;
    caption?: string | null;
    sort_order?: number;
  }>;
  attachment_metadata?: Array<{
    asset_id?: unknown;
    filename?: string | null;
    sort_order?: number;
  }>;
  customer_notes?: string | null;
  contract_snapshot?: string | null;
  show_client_signature?: boolean;
  show_company_signature?: boolean;
  subtotal_minor?: number;
  markup_total_minor?: number;
  discount_total_minor?: number;
  tax_total_minor?: number;
  deposit_requested_minor?: number;
  total_minor?: number;
  amount_paid_minor?: number;
  amount_refunded_minor?: number;
  amount_disputed_minor?: number;
  balance_due_minor?: number;
  frozen_revision_number?: number | null;
  settings_snapshot?: { currency?: string } | null;
};

export type ClientSignatureSource = {
  signer_name: string;
  signed_at: string | Date;
} | null;

function toIsoOrNull(value: string | Date | null | undefined): string | null {
  if (value == null || value === '') {
    return null;
  }
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value.toISOString();
  }
  return String(value);
}

function cloneAddress(
  address: RendererAddress | null | undefined,
): RendererAddress | null {
  if (!address) {
    return null;
  }
  return {
    street: address.street ?? null,
    suite: address.suite ?? null,
    city: address.city ?? null,
    state: address.state ?? null,
    postal_code: address.postal_code ?? null,
    country: address.country ?? null,
  };
}

function stringId(value: unknown): string | null {
  if (value == null) {
    return null;
  }
  const next = String(value).trim();
  return next.length > 0 ? next : null;
}

function buildAssetList(
  ids: unknown[] | undefined,
  metadata:
    | Array<{
        asset_id?: unknown;
        caption?: string | null;
        filename?: string | null;
        sort_order?: number;
      }>
    | undefined,
  kind: 'photo' | 'attachment',
): DocumentRendererAsset[] {
  const labels = new Map<string, string>();
  const order = new Map<string, number>();
  for (const entry of metadata ?? []) {
    const id = stringId(entry.asset_id);
    if (!id) continue;
    const label =
      kind === 'attachment' ? entry.filename?.trim() : entry.caption?.trim();
    if (label) labels.set(id, label);
    order.set(id, entry.sort_order ?? order.get(id) ?? 0);
  }
  return (ids ?? [])
    .map((id, index) => {
      const assetId = stringId(id);
      if (!assetId) return null;
      const fallback =
        kind === 'attachment'
          ? `Attachment ${index + 1}`
          : `Photo ${index + 1}`;
      return {
        asset_id: assetId,
        label: labels.get(assetId) ?? fallback,
        kind,
        sort_order: order.get(assetId) ?? index,
      };
    })
    .filter(
      (asset): asset is DocumentRendererAsset & { sort_order: number } =>
        asset !== null,
    )
    .sort((a, b) => a.sort_order - b.sort_order)
    .map(({ sort_order: _sortOrder, ...asset }) => asset);
}

/**
 * Build the allowlisted renderer model from a persisted document aggregate.
 */
export function buildDocumentRendererModel(
  source: DocumentRendererSource,
  options: { clientSignature?: ClientSignatureSource } = {},
): DocumentRendererModel {
  const company = source.company_snapshot ?? {};
  const client = source.client_snapshot ?? {};
  const lines = [...(source.line_items ?? [])].sort(
    (a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0),
  );

  const model: DocumentRendererModel = {
    document_type: source.type,
    number: source.number,
    po_number: source.po_number ?? null,
    status: source.status,
    issue_date: toIsoOrNull(source.issue_date),
    expiration_date: toIsoOrNull(source.expiration_date),
    due_date: toIsoOrNull(source.due_date),
    job_name: source.job_name ?? null,
    service_address: cloneAddress(source.service_address_snapshot),
    company: {
      display_name: company.display_name?.trim() || 'Company',
      legal_name: company.legal_name ?? null,
      phone: company.phone ?? null,
      email: company.email ?? null,
      website: company.website ?? null,
      address: cloneAddress(company.address ?? null),
      license_number: company.license_number ?? null,
    },
    client: {
      display_name: client.display_name?.trim() || 'Client',
      company_name: client.company_name ?? null,
      email: client.email ?? null,
      phone: client.phone ?? null,
      billing_address: cloneAddress(client.billing_address ?? null),
    },
    line_items: lines.map((line, index) => ({
      sort_order: line.sort_order ?? index,
      line_type: line.line_type ?? 'service',
      description: line.description?.trim() || 'Line item',
      notes: line.notes ?? null,
      unit_of_measure: line.unit_of_measure ?? null,
      quantity_milli: line.quantity_milli ?? 0,
      rate_minor: line.rate_minor ?? 0,
      markup_amount_minor: line.markup_amount_minor ?? 0,
      discount_amount_minor: line.discount_amount_minor ?? 0,
      tax_amount_minor: line.tax_amount_minor ?? 0,
      subtotal_minor: line.subtotal_minor ?? 0,
      total_minor: line.total_minor ?? 0,
      photo_assets: buildAssetList(line.photo_asset_ids, undefined, 'photo'),
    })),
    document_photos: buildAssetList(
      source.document_photo_asset_ids,
      source.document_photo_metadata,
      'photo',
    ),
    attachments: buildAssetList(
      source.attachment_asset_ids,
      source.attachment_metadata,
      'attachment',
    ),
    customer_notes: source.customer_notes ?? null,
    contract_body: source.contract_snapshot ?? null,
    show_client_signature: source.show_client_signature === true,
    show_company_signature: source.show_company_signature === true,
    client_signature: options.clientSignature
      ? {
          signer_name: options.clientSignature.signer_name,
          signed_at: toIsoOrNull(options.clientSignature.signed_at) ?? '',
        }
      : null,
    totals: {
      subtotal_minor: source.subtotal_minor ?? 0,
      markup_total_minor: source.markup_total_minor ?? 0,
      discount_total_minor: source.discount_total_minor ?? 0,
      tax_total_minor: source.tax_total_minor ?? 0,
      deposit_requested_minor: source.deposit_requested_minor ?? 0,
      total_minor: source.total_minor ?? 0,
      payments_applied_minor:
        source.type === 'invoice'
          ? Math.max(
              0,
              (source.amount_paid_minor ?? 0) -
                (source.amount_refunded_minor ?? 0) -
                (source.amount_disputed_minor ?? 0),
            )
          : 0,
      amount_due_minor:
        source.type === 'invoice'
          ? (source.balance_due_minor ?? source.total_minor ?? 0)
          : 0,
    },
    frozen_revision_number: source.frozen_revision_number ?? null,
    currency: 'usd',
  };

  assertDocumentRendererSafe(model);
  return model;
}

/**
 * Deep-scan renderer JSON for forbidden keys/substrings.
 * Throws if any customer-facing leak is detected.
 */
export function assertDocumentRendererSafe(model: unknown): void {
  const serialized = JSON.stringify(model);
  for (const key of DOCUMENT_RENDERER_FORBIDDEN_KEYS) {
    // Match JSON object keys: "forbidden_key":
    const keyPattern = new RegExp(`"${key}"\\s*:`);
    if (keyPattern.test(serialized)) {
      throw new Error(
        `Document renderer leak detected: forbidden key "${key}"`,
      );
    }
  }
}

export function collectForbiddenKeysPresent(model: unknown): string[] {
  const serialized = JSON.stringify(model);
  return DOCUMENT_RENDERER_FORBIDDEN_KEYS.filter((key) =>
    new RegExp(`"${key}"\\s*:`).test(serialized),
  );
}
