import { renderDocumentHtml } from './document-pdf-template';
import { buildDocumentRendererModel } from './document-renderer';

describe('document-pdf-template', () => {
  it('renders customer fields and omits private/internal keys', () => {
    const model = buildDocumentRendererModel({
      type: 'estimate',
      number: 'EST-100',
      status: 'pending',
      customer_notes: 'Customer note',
      contract_snapshot: 'Pay on approval',
      company_snapshot: {
        display_name: 'Acme Builders',
        website: 'https://acme-builders.example',
      },
      client_snapshot: { display_name: 'Client Co' },
      line_items: [
        {
          sort_order: 0,
          description: 'Drywall',
          quantity_milli: 1000,
          rate_minor: 5000,
          tax_amount_minor: 400,
          total_minor: 5400,
        },
      ],
      subtotal_minor: 5000,
      tax_total_minor: 400,
      total_minor: 5400,
      show_client_signature: true,
      show_company_signature: true,
      document_photo_asset_ids: ['photo-1'],
      attachment_asset_ids: ['attachment-1'],
      attachment_metadata: [
        { asset_id: 'attachment-1', filename: 'Permit.pdf', sort_order: 0 },
      ],
      frozen_revision_number: 1,
    });

    const html = renderDocumentHtml(model);
    expect(html).toContain('EST-100');
    expect(html).toContain('class="brand-logo"');
    expect(html).toContain('data:image/jpeg;base64,');
    expect(html).toContain('https://acme-builders.example');
    expect(html).toContain('Drywall');
    expect(html).toContain('Customer note');
    expect(html).toContain('Pay on approval');
    expect(html).toContain('Client signature');
    expect(html).toContain('Company signature');
    expect(html).toContain('Authorized signature');
    expect(html).not.toContain('photo attached');
    expect(html).not.toContain('Permit.pdf');
    expect(html).not.toContain('private_notes');
    expect(html).not.toContain('vendor_name');
    expect(html).not.toContain('internal_unit_cost');
    expect(html).not.toContain('purchase_status');
  });

  it('renders payment-adjusted totals for invoices', () => {
    const model = buildDocumentRendererModel({
      type: 'invoice',
      number: 'INV-100',
      status: 'partial',
      company_snapshot: { display_name: 'Acme Builders' },
      client_snapshot: { display_name: 'Client Co' },
      subtotal_minor: 10_000,
      total_minor: 10_000,
      amount_paid_minor: 4_000,
      balance_due_minor: 6_000,
    });

    const html = renderDocumentHtml(model);
    expect(html).toContain('Payments applied');
    expect(html).toContain('Balance due');
    expect(html).toContain('$60.00');
  });
});
