import type { DocumentRendererModel } from './document-renderer';
import { INVOICE_LOGO_DATA_URL } from '../estimates/invoice-logo';

function escapeHtml(value: string) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function formatMoney(minor: number) {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
  }).format(minor / 100);
}

function formatQty(milli: number) {
  const units = milli / 1000;
  return Number.isInteger(units) ? String(units) : units.toFixed(3);
}

function formatDate(value: string | null) {
  if (!value) {
    return '—';
  }
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(value));
}

function buildInvoicePaymentUrl(publicUrl: string) {
  const url = new URL(publicUrl);
  const viewPrefix = '/view/invoice/';
  if (!url.pathname.startsWith(viewPrefix)) {
    throw new Error('Public invoice URL has an unsupported path.');
  }

  const token = url.pathname.slice(viewPrefix.length);
  url.pathname = `/checkout/invoice/${token}`;
  url.search = '';
  url.hash = '';
  return url.toString();
}

function formatAddress(
  address: DocumentRendererModel['service_address'],
): string {
  if (!address) {
    return '';
  }
  return [
    address.street,
    address.suite,
    [address.city, address.state].filter(Boolean).join(', '),
    address.postal_code,
  ]
    .map((part) => (typeof part === 'string' ? part.trim() : ''))
    .filter(Boolean)
    .join(', ');
}

/**
 * Deterministic HTML for estimate/invoice customer documents.
 * Stable estimate and invoice PDF layout shared by all document delivery paths.
 */
export function renderDocumentHtml(model: DocumentRendererModel): string {
  const title = model.document_type === 'estimate' ? 'Estimate' : 'Invoice';
  const linesHtml = model.line_items
    .map(
      (line) => `
      <tr>
        <td>
          <div class="line-desc">${escapeHtml(line.description)}</div>
          ${line.notes ? `<div class="line-note">${escapeHtml(line.notes)}</div>` : ''}
        </td>
        <td class="num">${escapeHtml(formatQty(line.quantity_milli))}${
          line.unit_of_measure ? ` ${escapeHtml(line.unit_of_measure)}` : ''
        }</td>
        <td class="num">${escapeHtml(formatMoney(line.rate_minor))}</td>
        <td class="num">${escapeHtml(formatMoney(line.tax_amount_minor))}</td>
        <td class="num">${escapeHtml(formatMoney(line.total_minor))}</td>
      </tr>`,
    )
    .join('');

  const serviceAddress = formatAddress(model.service_address);
  const billingAddress = formatAddress(model.client.billing_address);
  const companyAddress = formatAddress(model.company.address);
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>${escapeHtml(title)} ${escapeHtml(model.number)}</title>
  <style>
    @page { size: Letter; margin: 0.6in; }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      font-family: "Helvetica Neue", Helvetica, Arial, sans-serif;
      color: #071d3f;
      font-size: 12px;
      line-height: 1.45;
    }
    .header { display: flex; justify-content: space-between; gap: 24px; margin-bottom: 28px; }
    .brand-logo { display: block; width: 178px; max-width: 100%; height: auto; object-fit: contain; margin-bottom: 10px; }
    .brand { color: #071d3f; font-size: 22px; font-weight: 700; letter-spacing: -0.02em; }
    .meta { text-align: right; }
    .meta h1 { color: #174f8e; margin: 0 0 8px; font-size: 20px; }
    .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; margin-bottom: 24px; }
    .grid.single { grid-template-columns: 1fr; }
    .label { color: #174f8e; font-size: 10px; text-transform: uppercase; letter-spacing: 0.06em; margin-bottom: 4px; }
    table { width: 100%; border-collapse: collapse; margin-bottom: 20px; }
    th { text-align: left; font-size: 10px; text-transform: uppercase; letter-spacing: 0.05em; color: #174f8e; border-bottom: 1px solid #c8d6e5; padding: 8px 6px; }
    td { border-bottom: 1px solid #d4dfea; padding: 10px 6px; vertical-align: top; }
    td.num, th.num { text-align: right; white-space: nowrap; }
    .line-desc { font-weight: 600; }
    .line-note { color: #52677f; margin-top: 2px; }
    .totals { width: 260px; margin-left: auto; }
    .totals-row { display: flex; justify-content: space-between; padding: 4px 0; }
    .totals-row.grand { color: #071d3f; font-size: 14px; font-weight: 700; border-top: 1px solid #071d3f; margin-top: 6px; padding-top: 8px; }
    .notes, .contract { margin-top: 24px; }
    .signatures { display: grid; grid-template-columns: 1fr 1fr; gap: 32px; margin-top: 40px; }
    .sig-box { border-top: 1px solid #8fa8c1; padding-top: 8px; min-height: 64px; }
    .muted { color: #52677f; }
  </style>
</head>
<body>
  <div class="header">
    <div>
      <img class="brand-logo" src="${escapeHtml(INVOICE_LOGO_DATA_URL)}" alt="${escapeHtml(model.company.display_name)} logo" />
      <div class="brand">${escapeHtml(model.company.display_name)}</div>
      ${companyAddress ? `<div class="muted">${escapeHtml(companyAddress)}</div>` : ''}
      ${model.company.phone ? `<div class="muted">${escapeHtml(model.company.phone)}</div>` : ''}
      ${model.company.email ? `<div class="muted">${escapeHtml(model.company.email)}</div>` : ''}
      ${model.company.website ? `<div class="muted">${escapeHtml(model.company.website)}</div>` : ''}
      ${model.company.license_number ? `<div class="muted">License ${escapeHtml(model.company.license_number)}</div>` : ''}
    </div>
    <div class="meta">
      <h1>${escapeHtml(title)}</h1>
      <div><strong>${escapeHtml(model.number)}</strong></div>
      <div>Date ${escapeHtml(formatDate(model.issue_date))}</div>
      ${model.expiration_date ? `<div>Expires ${escapeHtml(formatDate(model.expiration_date))}</div>` : ''}
      ${model.document_type === 'invoice' && model.due_date ? `<div>Due ${escapeHtml(formatDate(model.due_date))}</div>` : ''}
      ${model.po_number ? `<div>PO ${escapeHtml(model.po_number)}</div>` : ''}
    </div>
  </div>

  <div class="grid${model.job_name || serviceAddress ? '' : ' single'}">
    <div>
      <div class="label">Bill to</div>
      <div><strong>${escapeHtml(model.client.display_name)}</strong></div>
      ${model.client.company_name ? `<div>${escapeHtml(model.client.company_name)}</div>` : ''}
      ${billingAddress ? `<div class="muted">${escapeHtml(billingAddress)}</div>` : ''}
      ${model.client.email ? `<div class="muted">${escapeHtml(model.client.email)}</div>` : ''}
      ${model.client.phone ? `<div class="muted">${escapeHtml(model.client.phone)}</div>` : ''}
    </div>
    ${
      model.job_name || serviceAddress
        ? `<div>
            <div class="label">Job</div>
            ${model.job_name ? `<div><strong>${escapeHtml(model.job_name)}</strong></div>` : ''}
            ${serviceAddress ? `<div class="muted">${escapeHtml(serviceAddress)}</div>` : ''}
          </div>`
        : ''
    }
  </div>

  <table>
    <thead>
      <tr>
        <th>Description</th>
        <th class="num">Qty</th>
        <th class="num">Rate</th>
        <th class="num">Tax</th>
        <th class="num">Total</th>
      </tr>
    </thead>
    <tbody>${linesHtml}</tbody>
  </table>

  <div class="totals">
    <div class="totals-row"><span>Subtotal</span><span>${escapeHtml(formatMoney(model.totals.subtotal_minor))}</span></div>
    ${model.totals.markup_total_minor > 0 ? `<div class="totals-row"><span>Markup</span><span>${escapeHtml(formatMoney(model.totals.markup_total_minor))}</span></div>` : ''}
    ${model.totals.discount_total_minor > 0 ? `<div class="totals-row"><span>Discount</span><span>-${escapeHtml(formatMoney(model.totals.discount_total_minor))}</span></div>` : ''}
    <div class="totals-row"><span>Tax</span><span>${escapeHtml(formatMoney(model.totals.tax_total_minor))}</span></div>
    ${model.totals.deposit_requested_minor > 0 ? `<div class="totals-row"><span>Deposit requested</span><span>${escapeHtml(formatMoney(model.totals.deposit_requested_minor))}</span></div>` : ''}
    <div class="totals-row grand"><span>Total</span><span>${escapeHtml(formatMoney(model.totals.total_minor))}</span></div>
    ${model.document_type === 'invoice' && model.totals.payments_applied_minor > 0 ? `<div class="totals-row"><span>Payments applied</span><span>-${escapeHtml(formatMoney(model.totals.payments_applied_minor))}</span></div>` : ''}
    ${model.document_type === 'invoice' ? `<div class="totals-row grand"><span>Balance due</span><span>${escapeHtml(formatMoney(model.totals.amount_due_minor))}</span></div>` : ''}
  </div>

  ${
    model.customer_notes
      ? `<div class="notes"><div class="label">Notes</div><div>${escapeHtml(model.customer_notes)}</div></div>`
      : ''
  }
  ${
    model.contract_body
      ? `<div class="contract"><div class="label">Contract</div><div>${escapeHtml(model.contract_body)}</div></div>`
      : ''
  }

  ${
    model.show_client_signature || model.show_company_signature
      ? `<div class="signatures">
          ${
            model.show_client_signature
              ? `<div class="sig-box">
                  <div class="label">Client signature</div>
                  ${
                    model.client_signature
                      ? `<div>${escapeHtml(model.client_signature.signer_name)}</div>
                         <div class="muted">${escapeHtml(formatDate(model.client_signature.signed_at))}</div>`
                      : '<div class="muted">Pending</div>'
                  }
                </div>`
              : '<div></div>'
          }
          ${
            model.show_company_signature
              ? `<div class="sig-box">
                  <div class="label">Company signature</div>
                  <div>${escapeHtml(model.company.display_name)}</div>
                  <div class="muted">Authorized signature</div>
                </div>`
              : ''
          }
        </div>`
      : ''
  }
</body>
</html>`;
}

export function renderEstimateEmailBodies(input: {
  model: DocumentRendererModel;
  publicUrl: string;
  companyName: string;
  subject?: string | null;
  message?: string | null;
}) {
  const total = formatMoney(input.model.totals.total_minor);
  const subject =
    input.subject?.trim() ||
    `${input.companyName} Estimate ${input.model.number}`;
  const customMessage = input.message?.trim();
  const text = customMessage
    ? [customMessage, '', `View and respond securely: ${input.publicUrl}`].join(
        '\n',
      )
    : [
        `Hello ${input.model.client.display_name},`,
        '',
        `${input.companyName} sent you estimate ${input.model.number} for ${total}.`,
        '',
        `View and respond securely: ${input.publicUrl}`,
        '',
        'Thank you.',
      ].join('\n');
  const messageHtml = customMessage
    ? customMessage
        .split(/\n{2,}/)
        .map((part) => `<p>${escapeHtml(part).replaceAll('\n', '<br />')}</p>`)
        .join('')
    : `<p>Hello ${escapeHtml(input.model.client.display_name)},</p>
      <p><strong>${escapeHtml(input.companyName)}</strong> sent you estimate <strong>${escapeHtml(input.model.number)}</strong> for <strong>${escapeHtml(total)}</strong>.</p>`;

  const html = `
    <div style="font-family: Helvetica, Arial, sans-serif; color:#071d3f; line-height:1.5;">
      ${messageHtml}
      <p style="margin:24px 0;">
        <a href="${escapeHtml(input.publicUrl)}" style="background:#071d3f;color:#fff;padding:12px 18px;border-radius:6px;text-decoration:none;display:inline-block;">
          View estimate
        </a>
      </p>
      <p style="color:#52677f;font-size:12px;">Or open this link: ${escapeHtml(input.publicUrl)}</p>
    </div>
  `;

  return { subject, text, html };
}

export function renderInvoiceEmailBodies(input: {
  model: DocumentRendererModel;
  publicUrl: string;
  companyName: string;
  subject?: string | null;
  message?: string | null;
}) {
  const total = formatMoney(input.model.totals.total_minor);
  const paymentUrl = buildInvoicePaymentUrl(input.publicUrl);
  const subject =
    input.subject?.trim() ||
    `${input.companyName} Invoice ${input.model.number}`;
  const customMessage = input.message?.trim();
  const text = customMessage
    ? [
        customMessage,
        '',
        `Pay invoice securely: ${paymentUrl}`,
        `View or download invoice: ${input.publicUrl}`,
      ].join('\n')
    : [
        `Hello ${input.model.client.display_name},`,
        '',
        `${input.companyName} sent you invoice ${input.model.number} for ${total}.`,
        '',
        `Pay invoice securely: ${paymentUrl}`,
        '',
        `View or download invoice: ${input.publicUrl}`,
        '',
        'Thank you.',
      ].join('\n');
  const messageHtml = customMessage
    ? customMessage
        .split(/\n{2,}/)
        .map((part) => `<p>${escapeHtml(part).replaceAll('\n', '<br />')}</p>`)
        .join('')
    : `<p>Hello ${escapeHtml(input.model.client.display_name)},</p>
      <p><strong>${escapeHtml(input.companyName)}</strong> sent you invoice <strong>${escapeHtml(input.model.number)}</strong> for <strong>${escapeHtml(total)}</strong>.</p>`;

  const html = `
    <div style="font-family: Helvetica, Arial, sans-serif; color:#071d3f; line-height:1.5;">
      ${messageHtml}
      <p style="margin:28px 0;">
        <a href="${escapeHtml(paymentUrl)}" style="background:#071d3f;color:#fff;padding:14px 22px;border-radius:6px;text-decoration:none;display:inline-block;font-weight:600;">
          Pay ${escapeHtml(total)} securely
        </a>
      </p>
      <p style="font-size:13px;"><a href="${escapeHtml(input.publicUrl)}" style="color:#174f8e;">View or download invoice</a></p>
      <p style="color:#52677f;font-size:12px;">Secure payment link: ${escapeHtml(paymentUrl)}</p>
      <p style="color:#8fa8c1;font-size:11px;margin-top:16px;">The invoice PDF is also attached to this email.</p>
    </div>
  `;

  return { subject, text, html };
}
