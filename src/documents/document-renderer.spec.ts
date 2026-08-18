import {
  assertDocumentRendererSafe,
  buildDocumentRendererModel,
  collectForbiddenKeysPresent,
  DOCUMENT_RENDERER_FORBIDDEN_KEYS,
} from './document-renderer';

describe('document-renderer', () => {
  const source = {
    type: 'estimate' as const,
    number: 'EST-000001',
    po_number: 'PO-9',
    status: 'pending',
    issue_date: '2026-08-01T00:00:00.000Z',
    expiration_date: null,
    due_date: null,
    job_name: 'Kitchen',
    service_address_snapshot: {
      street: '1 Main',
      suite: null,
      city: 'Austin',
      state: 'TX',
      postal_code: '78701',
      country: 'US',
    },
    company_snapshot: {
      display_name: 'Home Pro',
      legal_name: null,
      phone: '555-0100',
      email: 'hello@example.com',
      website: null,
      address: null,
      license_number: null,
    },
    client_snapshot: {
      display_name: 'Ada Lovelace',
      company_name: null,
      email: 'ada@example.com',
      phone: '555-0200',
      billing_address: null,
    },
    line_items: [
      {
        sort_order: 0,
        line_type: 'material',
        description: 'Interior paint',
        notes: 'Eggshell',
        unit_of_measure: 'gallon',
        quantity_milli: 2000,
        rate_minor: 4500,
        markup_amount_minor: 0,
        discount_amount_minor: 0,
        tax_amount_minor: 800,
        subtotal_minor: 9000,
        total_minor: 9800,
        photo_asset_ids: ['line-photo-1'],
        // These must be stripped by the builder:
        internal_unit_cost_minor: 2000,
        vendor_name: 'Sherwin',
        purchase_status: 'needed',
        waste_basis_points: 1000,
        adjusted_quantity_milli: 2200,
        private_notes: 'should never appear',
      } as never,
    ],
    document_photo_asset_ids: ['photo-1'],
    attachment_asset_ids: ['attachment-1'],
    document_photo_metadata: [
      { asset_id: 'photo-1', caption: 'Before photo', sort_order: 0 },
    ],
    attachment_metadata: [
      { asset_id: 'attachment-1', filename: 'Permit.pdf', sort_order: 0 },
    ],
    customer_notes: 'Thanks for your business',
    contract_snapshot: 'Terms apply.',
    show_client_signature: true,
    show_company_signature: false,
    subtotal_minor: 9000,
    markup_total_minor: 0,
    discount_total_minor: 0,
    tax_total_minor: 800,
    deposit_requested_minor: 1000,
    total_minor: 9800,
    frozen_revision_number: 1,
    frozen_hash: 'abc123',
  };

  it('builds an allowlisted customer-facing model', () => {
    const model = buildDocumentRendererModel(source);
    expect(model.number).toBe('EST-000001');
    expect(model.client.display_name).toBe('Ada Lovelace');
    expect(model.line_items[0]).toMatchObject({
      description: 'Interior paint',
      quantity_milli: 2000,
      rate_minor: 4500,
      total_minor: 9800,
    });
    expect(model.totals.total_minor).toBe(9800);
    expect(model.customer_notes).toBe('Thanks for your business');
    expect(model.document_photos).toEqual([
      { asset_id: 'photo-1', label: 'Before photo', kind: 'photo' },
    ]);
    expect(model.attachments).toEqual([
      { asset_id: 'attachment-1', label: 'Permit.pdf', kind: 'attachment' },
    ]);
    expect(model.line_items[0].photo_assets).toEqual([
      { asset_id: 'line-photo-1', label: 'Photo 1', kind: 'photo' },
    ]);
  });

  it('exposes only net payment totals needed by an invoice customer', () => {
    const model = buildDocumentRendererModel({
      ...source,
      type: 'invoice',
      number: 'INV-000001',
      amount_paid_minor: 8_000,
      amount_refunded_minor: 1_000,
      amount_disputed_minor: 2_000,
      balance_due_minor: 4_800,
    });

    expect(model.totals.payments_applied_minor).toBe(5_000);
    expect(model.totals.amount_due_minor).toBe(4_800);
    expect(JSON.stringify(model)).not.toContain('amount_paid_minor');
    expect(JSON.stringify(model)).not.toContain('amount_disputed_minor');
  });

  it('excludes private notes and internal material fields', () => {
    const model = buildDocumentRendererModel(source);
    const forbidden = collectForbiddenKeysPresent(model);
    expect(forbidden).toEqual([]);
    expect(JSON.stringify(model)).not.toContain('Sherwin');
    expect(JSON.stringify(model)).not.toContain('abc123');
    expect(JSON.stringify(model)).not.toContain('private_notes');
    expect(JSON.stringify(model)).not.toContain('internal_unit_cost');
    expect(JSON.stringify(model)).not.toContain('purchase_status');
  });

  it('asserts against injected forbidden keys', () => {
    const model = buildDocumentRendererModel(source) as Record<string, unknown>;
    model.private_notes = 'leak';
    expect(() => assertDocumentRendererSafe(model)).toThrow(/private_notes/);
  });

  it('lists the forbidden key catalog', () => {
    expect(DOCUMENT_RENDERER_FORBIDDEN_KEYS).toContain('private_notes');
    expect(DOCUMENT_RENDERER_FORBIDDEN_KEYS).toContain('vendor_name');
    expect(DOCUMENT_RENDERER_FORBIDDEN_KEYS).toContain('purchase_status');
    expect(DOCUMENT_RENDERER_FORBIDDEN_KEYS).toContain('frozen_hash');
    expect(DOCUMENT_RENDERER_FORBIDDEN_KEYS).toContain('document_hash');
  });
});
