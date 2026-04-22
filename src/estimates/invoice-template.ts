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
  partNumber: string | null;
  quantity: number;
  price: number;
  subTotal: number;
};

export type InvoiceDocumentServiceGroup = {
  name: string;
  note: string | null;
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
  customerComment: string | null;
  recommendation: string | null;
  customerName: string;
  customerEmail: string | null;
  customerPhone: string;
  vehicleLabel: string;
  vehicleVin: string;
  vehiclePlate: string;
  vehicleYear: number | null;
  vehicleMake: string | null;
  vehicleModel: string | null;
  vehicleMileage: number | null;
  vehicleMileageOut: number | null;
  dueDate: string | null;
  generatedAt: string;
  paymentStatus: string;
  paymentType: string;
  subTotal: number;
  taxRate: number;
  taxAmount: number;
  total: number;
  amountPaid: number;
  amountRemaining: number;
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

function formatHeaderDate(value: string | null, timeZone: string) {
  if (!value) {
    return 'Not set';
  }

  return new Intl.DateTimeFormat('en-US', {
    month: '2-digit',
    day: '2-digit',
    year: 'numeric',
    timeZone,
  }).format(new Date(value));
}

function formatHeaderDateOnly(value: string | null) {
  if (!value) {
    return 'Not set';
  }

  const dateOnlyMatch = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  if (dateOnlyMatch) {
    const [, year, month, day] = dateOnlyMatch;
    return `${month}/${day}/${year}`;
  }

  return formatHeaderDate(value, 'UTC');
}

function formatCurrency(value: number) {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
  }).format(value);
}

function roundCurrency(value: number) {
  return Number((value + 1e-9).toFixed(2));
}

function formatMileage(value: number | null) {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return 'Not recorded';
  }

  return `${new Intl.NumberFormat('en-US', {
    maximumFractionDigits: 0,
  }).format(value)} mi`;
}

function formatVehicleDisplayName(invoice: InvoiceDocumentModel) {
  const make = invoice.vehicleMake?.trim();
  const model = invoice.vehicleModel?.trim();
  const yearPrefix =
    typeof invoice.vehicleYear === 'number' && Number.isFinite(invoice.vehicleYear)
      ? `${invoice.vehicleYear} `
      : '';
  const makeModel = [make?.toUpperCase(), model].filter(Boolean).join(' ');

  return makeModel ? `${yearPrefix}${makeModel}` : invoice.vehicleLabel;
}

function normalizeOptionalInvoiceText(value: string | null) {
  const trimmed = value?.trim();
  if (!trimmed) {
    return null;
  }

  const normalized = trimmed.toLowerCase();
  const placeholderValues = new Set(['-', '—', '--', 'n/a', 'na', 'none']);

  return placeholderValues.has(normalized) ? null : trimmed;
}

function renderInvoiceLogo(input: {
  src: string;
  alt: string;
  maxWidth: number;
  marginBottom: number;
}) {
  return `<img src="${escapeHtml(input.src)}" alt="${escapeHtml(input.alt)}" width="${input.maxWidth}" style="display:block;width:100%;max-width:${input.maxWidth}px;height:auto;margin:0 0 ${input.marginBottom}px;" />`;
}

function summarizeServices(services: InvoiceDocumentServiceGroup[]) {
  return services.reduce(
    (summary, service) => ({
      laborTotal: summary.laborTotal + service.laborTotal,
      partsTotal: summary.partsTotal + service.partsTotal,
      grandTotal: summary.grandTotal + service.total,
    }),
    { laborTotal: 0, partsTotal: 0, grandTotal: 0 },
  );
}

function renderInvoiceLineItemsTable(services: InvoiceDocumentServiceGroup[]) {
  if (!services.length) {
    return '';
  }

  return services
    .map((service) => {
      const laborRows = service.laborLines
        .map(
          (line) => `
            <tr>
              <td style="padding:10px;border:1px solid #d7dee7;font-size:12px;color:#111827;">${escapeHtml(line.description)}</td>
              <td style="padding:10px;border:1px solid #d7dee7;font-size:12px;color:#111827;">${line.hours}</td>
              <td style="padding:10px;border:1px solid #d7dee7;font-size:12px;color:#111827;">${formatCurrency(line.rate)}</td>
              <td style="padding:10px;border:1px solid #d7dee7;text-align:right;font-size:12px;color:#111827;">${formatCurrency(line.subTotal)}</td>
            </tr>`,
        )
        .join('');

      const partRows = service.partLines
        .map(
          (line) => `
            <tr>
              <td style="padding:10px;border:1px solid #d7dee7;font-size:12px;color:#111827;">${escapeHtml(line.description)}</td>
              <td style="padding:10px;border:1px solid #d7dee7;font-size:12px;color:#111827;">${line.quantity}</td>
              <td style="padding:10px;border:1px solid #d7dee7;font-size:12px;color:#111827;">${formatCurrency(line.price)}</td>
              <td style="padding:10px;border:1px solid #d7dee7;text-align:right;font-size:12px;color:#111827;">${formatCurrency(line.subTotal)}</td>
            </tr>`,
        )
        .join('');

      return `
        <div style="border-top:1px solid #e2e8f0;padding-top:16px;">
          <p style="margin:0;font-size:14px;font-weight:600;color:#111827;">${escapeHtml(service.name.toUpperCase())}</p>
          ${
            service.note
              ? `<p style="margin:6px 0 0;font-size:12px;color:#64748b;">${escapeHtml(service.note)}</p>`
              : ''
          }
          ${
            service.laborLines.length > 0
              ? `
              <div style="margin-top:12px;overflow-x:auto;">
                <table style="width:100%;min-width:560px;border-collapse:collapse;border:1px solid #cbd5e1;">
                  <thead>
                    <tr style="text-align:left;">
                      <th style="padding:10px;border:1px solid #cbd5e1;font-size:11px;font-weight:600;color:#0f172a;background:#f3f4f6;text-transform:uppercase;letter-spacing:0.08em;">Labor rates</th>
                      <th style="padding:10px;border:1px solid #cbd5e1;font-size:11px;font-weight:600;color:#0f172a;background:#f3f4f6;text-transform:uppercase;letter-spacing:0.08em;">Hours</th>
                      <th style="padding:10px;border:1px solid #cbd5e1;font-size:11px;font-weight:600;color:#0f172a;background:#f3f4f6;text-transform:uppercase;letter-spacing:0.08em;">Rate / hr</th>
                      <th style="padding:10px;border:1px solid #cbd5e1;font-size:11px;font-weight:600;color:#0f172a;background:#f3f4f6;text-transform:uppercase;letter-spacing:0.08em;text-align:right;">Amount</th>
                    </tr>
                  </thead>
                  <tbody>
                    ${laborRows}
                  </tbody>
                </table>
              </div>`
              : ''
          }
          ${
            service.partLines.length > 0
              ? `
              <div style="margin-top:12px;overflow-x:auto;">
                <table style="width:100%;min-width:560px;border-collapse:collapse;border:1px solid #cbd5e1;">
                  <thead>
                    <tr style="text-align:left;">
                      <th style="padding:10px;border:1px solid #cbd5e1;font-size:11px;font-weight:600;color:#0f172a;background:#f3f4f6;text-transform:uppercase;letter-spacing:0.08em;">Part used</th>
                      <th style="padding:10px;border:1px solid #cbd5e1;font-size:11px;font-weight:600;color:#0f172a;background:#f3f4f6;text-transform:uppercase;letter-spacing:0.08em;">Qty</th>
                      <th style="padding:10px;border:1px solid #cbd5e1;font-size:11px;font-weight:600;color:#0f172a;background:#f3f4f6;text-transform:uppercase;letter-spacing:0.08em;">Rate</th>
                      <th style="padding:10px;border:1px solid #cbd5e1;font-size:11px;font-weight:600;color:#0f172a;background:#f3f4f6;text-transform:uppercase;letter-spacing:0.08em;text-align:right;">Amount</th>
                    </tr>
                  </thead>
                  <tbody>
                    ${partRows}
                  </tbody>
                </table>
              </div>`
              : ''
          }
        </div>
      `;
    })
    .join('');
}

function renderInvoiceNoteSection(title: string, value: string) {
  return `
    <p style="margin:0;font-size:14px;font-weight:600;color:#0f172a;letter-spacing:0.08em;">${escapeHtml(title)}</p>
    <p style="margin:4px 0 0;font-size:12px;color:#334155;white-space:pre-line;">${escapeHtml(value)}</p>
  `;
}

function renderInvoiceNotes(invoice: InvoiceDocumentModel) {
  const customerComment = normalizeOptionalInvoiceText(invoice.customerComment);
  const recommendation = normalizeOptionalInvoiceText(invoice.recommendation);

  if (!customerComment && !recommendation) {
    return '';
  }

  if (customerComment && recommendation) {
    return `
      <div style="border-top:1px solid #e2e8f0;margin-top:20px;padding-top:16px;" class="note-grid">
        <div class="note-col" style="padding-right:12px;">
          ${renderInvoiceNoteSection('CUSTOMER COMMENT', customerComment)}
        </div>
        <div class="note-col-right" style="padding-left:12px;">
          ${renderInvoiceNoteSection('RECOMMENDATION', recommendation)}
        </div>
      </div>
    `;
  }

  return `
    <div style="border-top:1px solid #e2e8f0;margin-top:20px;padding-top:16px;">
      ${renderInvoiceNoteSection(
        customerComment ? 'CUSTOMER COMMENT' : 'RECOMMENDATION',
        customerComment ?? recommendation ?? '',
      )}
    </div>
  `;
}

export function renderInvoiceDocumentHtml(
  invoice: InvoiceDocumentModel,
  options: { logoSrc?: string } = {},
) {
  const logoSrc = options.logoSrc ?? INVOICE_LOGO_DATA_URL;
  const invoiceSummary = summarizeServices(invoice.services);
  const subTotal = Math.max(invoice.subTotal ?? invoiceSummary.grandTotal, 0);
  const total = Math.max(invoice.total ?? subTotal, 0);
  const amountPaid = Math.min(
    Math.max(invoice.amountPaid ?? 0, 0),
    total,
  );
  const amountRemaining = Math.max(total - amountPaid, 0);
  const paidLabel =
    invoice.paymentStatus === 'PART_PAID' ? 'Part paid' : 'Amount paid';
  const lineItemsTable = renderInvoiceLineItemsTable(invoice.services);
  const noteSections = renderInvoiceNotes(invoice);
  const businessName = 'GMB Auto';
  const businessAddressLine1 = '301 Elmont Rd';
  const businessAddressLine2 = 'Elmont, NY 11003';
  const businessPhone = '(646) 807-6937';
  const businessEmail = 'gmb.auto@yahoo.com';
  const serviceWriterName = 'M Rico';
  const createdDate = formatHeaderDate(invoice.generatedAt, invoice.timeZone);
  const invoicedDate = formatHeaderDate(invoice.generatedAt, invoice.timeZone);
  const paymentDueDate = formatHeaderDateOnly(invoice.dueDate);

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Invoice ${escapeHtml(invoice.invoiceNumber)} from GMB Auto</title>
    <style>
      :root { color-scheme: light; }
      html, body { margin: 0; padding: 0; }
      body {
        background: #f8fafc;
        color: #0f172a;
        font-family: Helvetica, Arial, sans-serif;
        -webkit-font-smoothing: antialiased;
      }
      * {
        -webkit-print-color-adjust: exact;
        print-color-adjust: exact;
      }
      @page {
        size: Letter;
        margin: 24px;
      }
      .invoice-shell {
        margin: 0;
        padding: 24px;
        background: #f8fafc;
      }
      .invoice-card {
        margin: 0 auto;
        width: 100%;
        max-width: 760px;
        border: 1px solid rgba(228,228,231,0.7);
        border-radius: 12px;
        background: #ffffff;
        color: #0f172a;
        box-shadow: 0 1px 2px rgba(15,23,42,0.06);
        padding: 20px;
      }
      .invoice-header {
        display: flex;
        justify-content: space-between;
        gap: 20px;
        width: 100%;
      }
      .header-col {
        flex: 1 1 0;
        min-width: 0;
      }
      .header-left {
        text-align: left;
      }
      .header-center {
        display: flex;
        justify-content: center;
      }
      .header-right {
        text-align: right;
      }
      .meta-grid {
        display: table;
        width: 100%;
        table-layout: fixed;
      }
      .meta-col,
      .meta-col-right {
        display: table-cell;
        vertical-align: top;
      }
      .meta-col-right {
        text-align: right;
      }
      .note-grid {
        display: table;
        width: 100%;
        table-layout: fixed;
      }
      .note-col,
      .note-col-right {
        display: table-cell;
        vertical-align: top;
      }
      .note-col-right {
        text-align: right;
      }
      @media only screen and (max-width: 720px) {
        .invoice-shell {
          padding: 16px !important;
        }
        .invoice-card {
          padding: 16px !important;
          border-radius: 8px !important;
        }
        .invoice-header,
        .meta-grid,
        .note-grid {
          display: block !important;
        }
        .header-left,
        .header-center,
        .header-right,
        .meta-col,
        .meta-col-right,
        .note-col,
        .note-col-right {
          display: block !important;
          width: 100% !important;
          text-align: left !important;
        }
        .header-right,
        .header-center,
        .meta-col-right,
        .note-col-right {
          margin-top: 12px !important;
        }
      }
    </style>
  </head>
  <body>
    <div class="invoice-shell">
      <div class="invoice-card">
        <div style="border-bottom:1px solid #e2e8f0;padding-bottom:16px;">
          <div class="invoice-header">
            <div class="header-col header-left">
              <p style="margin:0;font-size:16px;font-weight:700;color:#0f172a;">${escapeHtml(businessName)}</p>
              <p style="margin:5px 0 0;font-size:12px;line-height:1.45;color:#334155;">${escapeHtml(businessAddressLine1)}</p>
              <p style="margin:2px 0 0;font-size:12px;line-height:1.45;color:#334155;">${escapeHtml(businessAddressLine2)}</p>
              <p style="margin:2px 0 0;font-size:12px;line-height:1.45;color:#334155;">${escapeHtml(businessPhone)}</p>
              <p style="margin:2px 0 0;font-size:12px;line-height:1.45;color:#334155;">${escapeHtml(businessEmail)}</p>
            </div>
            <div class="header-col header-center">
              <div style="display:inline-flex;align-items:center;justify-content:center;border:1px solid #e2e8f0;background:rgba(248,250,252,0.7);padding:8px 12px;border-radius:6px;box-shadow:0 1px 2px rgba(15,23,42,0.06);">
                ${renderInvoiceLogo({
                  src: logoSrc,
                  alt: 'GMB Auto Logo',
                  maxWidth: 220,
                  marginBottom: 0,
                })}
              </div>
            </div>
            <div class="header-col header-right">
              <p style="margin:0;font-size:14px;font-weight:700;color:#0f172a;">Invoice #${escapeHtml(invoice.invoiceNumber)}</p>
              <p style="margin:5px 0 0;font-size:12px;line-height:1.45;color:#334155;">Created: ${escapeHtml(createdDate)}</p>
              <p style="margin:2px 0 0;font-size:12px;line-height:1.45;color:#334155;">Invoiced: ${escapeHtml(invoicedDate)}</p>
              <p style="margin:2px 0 0;font-size:12px;line-height:1.45;color:#334155;">Payment Term: On Receipt</p>
              <p style="margin:2px 0 0;font-size:12px;line-height:1.45;color:#334155;">Payment Due: ${escapeHtml(paymentDueDate)}</p>
              <p style="margin:2px 0 0;font-size:12px;line-height:1.45;color:#334155;">Service Writer: ${escapeHtml(serviceWriterName)}</p>
            </div>
          </div>
          <p style="margin:14px 0 0;font-size:18px;line-height:1.2;font-weight:700;color:#0f172a;">${escapeHtml(invoice.title)}</p>
        </div>

        <div style="margin-top:20px;" class="meta-grid">
          <div class="meta-col">
            <p style="margin:0;font-size:14px;font-weight:600;color:#0f172a;">Bill To</p>
            <p style="margin:4px 0 0;font-size:14px;color:#0f172a;">${escapeHtml(invoice.customerName)}</p>
            ${
              invoice.customerEmail
                ? `<p style="margin:2px 0 0;font-size:12px;color:#475569;">${escapeHtml(invoice.customerEmail)}</p>`
                : ''
            }
            <p style="margin:2px 0 0;font-size:12px;color:#475569;">${escapeHtml(invoice.customerPhone)}</p>
          </div>
          <div class="meta-col-right">
            <p style="margin:0;font-size:14px;font-weight:700;color:#0f172a;">${escapeHtml(formatVehicleDisplayName(invoice))}</p>
            <p style="margin:4px 0 0;font-size:12px;color:#475569;">VIN: ${escapeHtml(invoice.vehicleVin)}</p>
            <p style="margin:2px 0 0;font-size:12px;color:#475569;">Mileage In: ${escapeHtml(formatMileage(invoice.vehicleMileage))}</p>
            <p style="margin:2px 0 0;font-size:12px;color:#475569;">Mileage Out: ${escapeHtml(formatMileage(invoice.vehicleMileageOut))}</p>
          </div>
        </div>

        ${noteSections}

        <div style="margin-top:20px;">
          ${lineItemsTable}
        </div>

        <div style="display:flex;justify-content:flex-end;margin-top:20px;border-top:1px solid #e2e8f0;padding-top:16px;">
          <div style="width:100%;max-width:320px;">
            <div style="display:flex;justify-content:space-between;align-items:center;">
              <span style="font-size:14px;color:#64748b;">Labor subtotal</span>
              <span style="font-size:14px;font-weight:500;color:#0f172a;">${formatCurrency(invoiceSummary.laborTotal)}</span>
            </div>
            <div style="display:flex;justify-content:space-between;align-items:center;margin-top:10px;">
              <span style="font-size:14px;color:#64748b;">Parts subtotal</span>
              <span style="font-size:14px;font-weight:500;color:#0f172a;">${formatCurrency(invoiceSummary.partsTotal)}</span>
            </div>
            <div style="display:flex;justify-content:space-between;align-items:center;margin-top:10px;">
              <span style="font-size:14px;color:#64748b;">Subtotal</span>
              <span style="font-size:14px;font-weight:500;color:#0f172a;">${formatCurrency(subTotal)}</span>
            </div>

            ${
              amountPaid > 0
                ? `<div style="display:flex;justify-content:space-between;align-items:center;margin-top:10px;">
              <span style="font-size:14px;color:#64748b;">${escapeHtml(paidLabel)}</span>
              <span style="font-size:14px;font-weight:500;color:#0f766e;">-${formatCurrency(amountPaid)}</span>
            </div>`
                : ''
            }
            <div style="display:flex;justify-content:space-between;align-items:center;margin-top:10px;padding-top:10px;border-top:1px solid #e2e8f0;">
              <span style="font-size:16px;font-weight:600;color:#0f172a;">Total due</span>
              <span style="font-size:16px;font-weight:600;color:#0f172a;">${formatCurrency(amountRemaining)}</span>
            </div>
          </div>
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
    alt: 'GMB Auto',
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
