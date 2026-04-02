import {
  INVOICE_LOGO_CONTENT_ID,
  INVOICE_LOGO_DATA_URL,
} from './invoice-logo';

export type InvoiceDocumentLaborLineItem = {
  description: string;
  hours: number;
  rate: number;
  subTotal: number;
};

export type InvoiceDocumentPartLineItem = {
  description: string;
  quantity: number;
  price: number;
  subTotal: number;
};

export type InvoiceDocumentServiceGroup = {
  name: string;
  laborTotal: number;
  partsTotal: number;
  total: number;
  laborLines: InvoiceDocumentLaborLineItem[];
  partLines: InvoiceDocumentPartLineItem[];
};

export type InvoiceDocumentModel = {
  invoiceNumber: string;
  estimateNumber: string;
  title: string;
  timeZone: string;
  customerName: string;
  customerEmail: string | null;
  customerPhone: string;
  vehicleLabel: string;
  vehicleVin: string;
  vehiclePlate: string;
  dueDate: string | null;
  generatedAt: string;
  paymentStatus: string;
  total: number;
  services: InvoiceDocumentServiceGroup[];
  mode: 'preview' | 'issued';
};

export type InvoiceEmailMessageModel = {
  invoiceNumber: string;
  customerName: string;
  estimateNumber: string;
  total: number;
  dueDate: string | null;
  timeZone: string;
};

function escapeHtml(value: string) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function formatDate(value: string | null, timeZone: string) {
  if (!value) {
    return 'Not set';
  }

  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone,
  }).format(new Date(value));
}

function formatCurrency(value: number) {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
  }).format(value);
}

function formatPaymentStatusLabel(value: string) {
  return value
    .toLowerCase()
    .split('_')
    .map((segment) => segment.charAt(0).toUpperCase() + segment.slice(1))
    .join(' ');
}

function renderInvoiceLogo(input: {
  src: string;
  alt: string;
  maxWidth: number;
  marginBottom: number;
}) {
  return `<img src="${escapeHtml(input.src)}" alt="${escapeHtml(input.alt)}" width="${input.maxWidth}" style="display:block;width:100%;max-width:${input.maxWidth}px;height:auto;margin:0 0 ${input.marginBottom}px;" />`;
}

function renderLaborTable(lines: InvoiceDocumentLaborLineItem[]) {
  const rows = lines
    .map(
      (line) => `
        <tr>
          <td style="padding:10px 12px;border-top:1px solid #e4e4e7;">${escapeHtml(line.description)}</td>
          <td style="padding:10px 12px;border-top:1px solid #e4e4e7;text-align:right;">${line.hours}</td>
          <td style="padding:10px 12px;border-top:1px solid #e4e4e7;text-align:right;">${formatCurrency(line.rate)}</td>
          <td style="padding:10px 12px;border-top:1px solid #e4e4e7;text-align:right;">${formatCurrency(line.subTotal)}</td>
        </tr>`,
    )
    .join('');

  return `
    <table style="width:100%;border-collapse:collapse;font-size:14px;margin-top:12px;">
      <thead style="background:#f4f4f5;">
        <tr>
          <th style="padding:10px 12px;text-align:left;font-size:12px;letter-spacing:0.08em;text-transform:uppercase;color:#52525b;">Labor</th>
          <th style="padding:10px 12px;text-align:right;font-size:12px;letter-spacing:0.08em;text-transform:uppercase;color:#52525b;">Hours</th>
          <th style="padding:10px 12px;text-align:right;font-size:12px;letter-spacing:0.08em;text-transform:uppercase;color:#52525b;">Rate</th>
          <th style="padding:10px 12px;text-align:right;font-size:12px;letter-spacing:0.08em;text-transform:uppercase;color:#52525b;">Subtotal</th>
        </tr>
      </thead>
      <tbody>
        ${
          rows ||
          `<tr><td colspan="4" style="padding:14px 12px;border-top:1px solid #e4e4e7;color:#71717a;">No labor lines.</td></tr>`
        }
      </tbody>
    </table>
  `;
}

function renderPartTable(lines: InvoiceDocumentPartLineItem[]) {
  const rows = lines
    .map(
      (line) => `
        <tr>
          <td style="padding:10px 12px;border-top:1px solid #e4e4e7;">${escapeHtml(line.description)}</td>
          <td style="padding:10px 12px;border-top:1px solid #e4e4e7;text-align:right;">${line.quantity}</td>
          <td style="padding:10px 12px;border-top:1px solid #e4e4e7;text-align:right;">${formatCurrency(line.price)}</td>
          <td style="padding:10px 12px;border-top:1px solid #e4e4e7;text-align:right;">${formatCurrency(line.subTotal)}</td>
        </tr>`,
    )
    .join('');

  return `
    <table style="width:100%;border-collapse:collapse;font-size:14px;margin-top:12px;">
      <thead style="background:#f4f4f5;">
        <tr>
          <th style="padding:10px 12px;text-align:left;font-size:12px;letter-spacing:0.08em;text-transform:uppercase;color:#52525b;">Part</th>
          <th style="padding:10px 12px;text-align:right;font-size:12px;letter-spacing:0.08em;text-transform:uppercase;color:#52525b;">Qty</th>
          <th style="padding:10px 12px;text-align:right;font-size:12px;letter-spacing:0.08em;text-transform:uppercase;color:#52525b;">Price</th>
          <th style="padding:10px 12px;text-align:right;font-size:12px;letter-spacing:0.08em;text-transform:uppercase;color:#52525b;">Subtotal</th>
        </tr>
      </thead>
      <tbody>
        ${
          rows ||
          `<tr><td colspan="4" style="padding:14px 12px;border-top:1px solid #e4e4e7;color:#71717a;">No part lines.</td></tr>`
        }
      </tbody>
    </table>
  `;
}

export function renderInvoiceDocumentHtml(
  invoice: InvoiceDocumentModel,
  options: { logoSrc?: string } = {},
) {
  const logoSrc = options.logoSrc ?? INVOICE_LOGO_DATA_URL;
  const paymentStatusLabel = formatPaymentStatusLabel(invoice.paymentStatus);
  const serviceGroups = invoice.services
    .map(
      (service) => `
        <section style="margin-top:16px;overflow:hidden;border:1px solid #e4e4e7;border-radius:8px;">
          <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:12px;padding:14px 16px;border-bottom:1px solid #e4e4e7;background:#fafafa;">
            <div>
              <p style="margin:0;font-size:12px;letter-spacing:0.12em;text-transform:uppercase;color:#71717a;">Service</p>
              <p style="margin:6px 0 0;font-size:18px;font-weight:600;">${escapeHtml(service.name)}</p>
            </div>
            <div style="text-align:right;">
              <p style="margin:0;font-size:12px;color:#71717a;">Labor ${formatCurrency(service.laborTotal)}</p>
              <p style="margin:4px 0 0;font-size:12px;color:#71717a;">Parts ${formatCurrency(service.partsTotal)}</p>
              <p style="margin:6px 0 0;font-size:16px;font-weight:700;">${formatCurrency(service.total)}</p>
            </div>
          </div>
          <div style="padding:16px;">
            ${renderLaborTable(service.laborLines)}
            ${renderPartTable(service.partLines)}
          </div>
        </section>
      `,
    )
    .join('');

  const footerNote =
    invoice.mode === 'preview'
      ? 'Preview generated from the current estimate state. Sending this invoice will lock the billing snapshot and attach the same PDF layout.'
      : 'This invoice reflects the billing snapshot and payment status captured for this estimate.';

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Invoice ${escapeHtml(invoice.invoiceNumber)} from Gmb Workshop</title>
    <style>
      :root { color-scheme: light; }
      html, body { margin: 0; padding: 0; }
      body {
        background: #f8fafc;
        color: #111827;
        font-family: Helvetica, Arial, sans-serif;
        -webkit-font-smoothing: antialiased;
      }
      @page {
        size: Letter;
        margin: 24px;
      }
      @media only screen and (max-width: 720px) {
        .invoice-shell {
          padding: 16px !important;
        }
        .invoice-card {
          padding: 24px !important;
        }
        .invoice-header-left,
        .invoice-header-right,
        .invoice-column {
          display: block !important;
          width: 100% !important;
          padding-left: 0 !important;
          padding-right: 0 !important;
        }
        .invoice-header-right {
          padding-top: 16px !important;
        }
      }
    </style>
  </head>
  <body>
    <div class="invoice-shell" style="margin:0;padding:24px;background:#f8fafc;">
      <div style="margin:0 auto;width:100%;max-width:760px;border:1px solid rgba(228,228,231,0.7);border-radius:8px;background:#ffffff;color:#111827;box-shadow:0 1px 2px 0 rgba(0,0,0,0.05);">
        <div class="invoice-card" style="padding:40px;">
          <div style="margin-bottom:28px;">
            <table role="presentation" style="width:100%;border-collapse:collapse;">
              <tr>
                <td class="invoice-header-left" style="vertical-align:top;padding:0 24px 0 0;">
                  ${renderInvoiceLogo({
                    src: logoSrc,
                    alt: 'Gmb Workshop',
                    maxWidth: 260,
                    marginBottom: 8,
                  })}
                  <p style="margin:4px 0 0;font-size:14px;color:#71717a;">Service &amp; Repair Billing</p>
                  <h1 style="margin:16px 0 0;font-size:36px;line-height:1.1;font-weight:700;">Service Invoice</h1>
                  <p style="margin:12px 0 0;font-size:16px;color:#52525b;">Estimate ${escapeHtml(invoice.estimateNumber)} · ${escapeHtml(invoice.title)}</p>
                </td>
                <td class="invoice-header-right" style="vertical-align:top;width:248px;">
                  <div style="min-width:248px;border:1px solid #d4d4d8;border-radius:8px;background:#fafafa;padding:20px;">
                    <p style="margin:0 0 4px;font-size:12px;letter-spacing:0.12em;text-transform:uppercase;color:#71717a;">Invoice</p>
                    <p style="margin:0 0 12px;font-size:24px;line-height:1.2;font-weight:700;">${escapeHtml(invoice.invoiceNumber)}</p>
                    <p style="margin:0 0 4px;font-size:14px;color:#52525b;">Generated ${formatDate(invoice.generatedAt, invoice.timeZone)}</p>
                    <p style="margin:0 0 4px;font-size:14px;color:#52525b;">Due ${formatDate(invoice.dueDate, invoice.timeZone)}</p>
                    <p style="margin:0;font-size:14px;color:#52525b;">Payment Status ${escapeHtml(paymentStatusLabel)}</p>
                  </div>
                </td>
              </tr>
            </table>
          </div>

          <div style="margin-bottom:28px;">
            <table role="presentation" style="width:100%;border-collapse:collapse;">
              <tr>
                <td class="invoice-column" style="vertical-align:top;width:50%;padding-right:8px;">
                  <div style="border:1px solid #e4e4e7;border-radius:8px;padding:16px;">
                    <p style="margin:0 0 10px;font-size:12px;letter-spacing:0.12em;text-transform:uppercase;color:#71717a;">Bill To</p>
                    <p style="margin:0 0 6px;font-size:16px;font-weight:600;">${escapeHtml(invoice.customerName)}</p>
                    <p style="margin:0 0 4px;font-size:14px;color:#52525b;">${escapeHtml(invoice.customerEmail ?? 'No email')}</p>
                    <p style="margin:0;font-size:14px;color:#52525b;">${escapeHtml(invoice.customerPhone)}</p>
                  </div>
                </td>
                <td class="invoice-column" style="vertical-align:top;width:50%;padding-left:8px;">
                  <div style="border:1px solid #e4e4e7;border-radius:8px;padding:16px;">
                    <p style="margin:0 0 10px;font-size:12px;letter-spacing:0.12em;text-transform:uppercase;color:#71717a;">Vehicle</p>
                    <p style="margin:0 0 6px;font-size:16px;font-weight:600;">${escapeHtml(invoice.vehicleLabel)}</p>
                    <p style="margin:0 0 4px;font-size:14px;color:#52525b;">VIN ${escapeHtml(invoice.vehicleVin)}</p>
                    <p style="margin:0;font-size:14px;color:#52525b;">Plate ${escapeHtml(invoice.vehiclePlate)}</p>
                  </div>
                </td>
              </tr>
            </table>
          </div>

          ${
            serviceGroups ||
            `<div style="padding:18px;border:1px solid #e4e4e7;border-radius:8px;color:#71717a;">No service groups on this invoice.</div>`
          }

          <div style="display:flex;justify-content:flex-end;margin-top:20px;">
            <div style="width:100%;max-width:280px;border:1px solid #d4d4d8;border-radius:8px;background:#fafafa;padding:18px;">
              <div style="display:flex;justify-content:space-between;align-items:center;font-size:14px;">
                <span>Total</span>
                <strong style="font-size:20px;">${formatCurrency(invoice.total)}</strong>
              </div>
            </div>
          </div>

          <p style="margin:20px 0 0;font-size:12px;line-height:1.6;color:#71717a;">${escapeHtml(footerNote)}</p>
        </div>
      </div>
    </div>
  </body>
</html>`;
}

export function renderInvoiceEmailMessageHtml(
  message: InvoiceEmailMessageModel,
) {
  const logoMarkup = renderInvoiceLogo({
    src: `cid:${INVOICE_LOGO_CONTENT_ID}`,
    alt: 'Gmb Workshop',
    maxWidth: 220,
    marginBottom: 12,
  });

  return `<!doctype html>
<html lang="en">
  <body style="margin:0;padding:24px;background:#f8fafc;color:#111827;font-family:Helvetica,Arial,sans-serif;">
    <div style="margin:0 auto;max-width:640px;border:1px solid #e4e4e7;border-radius:8px;background:#ffffff;padding:32px;">
      ${logoMarkup}
      <h1 style="margin:0 0 12px;font-size:28px;">Invoice ${escapeHtml(message.invoiceNumber)}</h1>
      <p style="margin:0 0 16px;font-size:15px;line-height:1.6;">Hello ${escapeHtml(message.customerName)},</p>
      <p style="margin:0 0 16px;font-size:15px;line-height:1.6;">
        Your invoice for estimate ${escapeHtml(message.estimateNumber)} is attached.
      </p>
      <div style="border:1px solid #e4e4e7;border-radius:8px;background:#fafafa;padding:16px;">
        <p style="margin:0 0 6px;font-size:14px;color:#52525b;">Amount due</p>
        <p style="margin:0;font-size:24px;font-weight:700;">${formatCurrency(message.total)}</p>
        <p style="margin:8px 0 0;font-size:14px;color:#52525b;">Due ${formatDate(message.dueDate, message.timeZone)}</p>
      </div>
      <p style="margin:16px 0 0;font-size:14px;line-height:1.6;color:#52525b;">
        Please open the attached PDF to review the service groups, labor, and parts billed on this estimate.
      </p>
    </div>
  </body>
</html>`;
}
