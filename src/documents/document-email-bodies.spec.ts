import type { DocumentRendererModel } from './document-renderer';
import { renderInvoiceEmailBodies } from './document-pdf-template';

function invoiceModel(): DocumentRendererModel {
  return {
    document_type: 'invoice',
    number: 'INV-000001',
    po_number: null,
    status: 'sent',
    issue_date: '2026-08-12T00:00:00.000Z',
    expiration_date: null,
    due_date: '2026-09-11T00:00:00.000Z',
    job_name: null,
    service_address: null,
    company: {
      display_name: 'Home Pro',
      legal_name: null,
      phone: null,
      email: null,
      website: null,
      address: null,
      license_number: null,
    },
    client: {
      display_name: 'Pat Client',
      company_name: null,
      email: 'pat@example.com',
      phone: null,
      billing_address: null,
    },
    line_items: [],
    document_photos: [],
    attachments: [],
    customer_notes: null,
    contract_body: null,
    show_client_signature: false,
    show_company_signature: false,
    client_signature: null,
    totals: {
      subtotal_minor: 10000,
      markup_total_minor: 0,
      discount_total_minor: 0,
      tax_total_minor: 0,
      deposit_requested_minor: 0,
      total_minor: 10000,
      payments_applied_minor: 0,
      amount_due_minor: 10000,
    },
    frozen_revision_number: 1,
    currency: 'usd',
  };
}

describe('renderInvoiceEmailBodies', () => {
  it('uses a payment-first CTA and preserves a separate invoice review link', () => {
    const result = renderInvoiceEmailBodies({
      model: invoiceModel(),
      publicUrl: 'https://app.example.com/view/invoice/secure-token',
      companyName: 'Home Pro',
    });

    expect(result.text).toContain(
      'Pay invoice securely: https://app.example.com/checkout/invoice/secure-token',
    );
    expect(result.text).toContain(
      'View or download invoice: https://app.example.com/view/invoice/secure-token',
    );
    expect(result.html).toContain(
      'href="https://app.example.com/checkout/invoice/secure-token"',
    );
    expect(result.html).toContain('Pay $100.00 securely');
    expect(result.html).toContain(
      'href="https://app.example.com/view/invoice/secure-token"',
    );
  });
});
