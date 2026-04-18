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
  dueDate: string | null;
  generatedAt: string;
  paymentStatus: string;
  paymentType: string;
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

function formatPaymentTypeLabel(value: string) {
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
              <td style="padding:9px 8px;border-bottom:1px solid #f1f5f9;font-size:12px;color:#111827;">${escapeHtml(line.description)}</td>
              <td style="padding:9px 8px;border-bottom:1px solid #f1f5f9;font-size:12px;color:#111827;">${line.hours}</td>
              <td style="padding:9px 8px;border-bottom:1px solid #f1f5f9;font-size:12px;color:#111827;">${formatCurrency(line.rate)}</td>
              <td style="padding:9px 8px;border-bottom:1px solid #f1f5f9;text-align:right;font-size:12px;color:#111827;">${formatCurrency(line.subTotal)}</td>
            </tr>`,
        )
        .join('');

      const partRows = service.partLines
        .map(
          (line) => `
            <tr>
              <td style="padding:9px 8px;border-bottom:1px solid #f1f5f9;font-size:12px;color:#111827;">${escapeHtml(line.description)}</td>
              <td style="padding:9px 8px;border-bottom:1px solid #f1f5f9;font-size:12px;color:#111827;">${line.quantity}</td>
              <td style="padding:9px 8px;border-bottom:1px solid #f1f5f9;font-size:12px;color:#111827;">${formatCurrency(line.price)}</td>
              <td style="padding:9px 8px;border-bottom:1px solid #f1f5f9;text-align:right;font-size:12px;color:#111827;">${formatCurrency(line.subTotal)}</td>
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
                <table style="width:100%;min-width:560px;border-collapse:collapse;">
                  <thead>
                    <tr style="border-bottom:1px solid #e2e8f0;text-align:left;color:#64748b;">
                      <th style="padding:8px;font-size:12px;font-weight:500;">Labor rates</th>
                      <th style="padding:8px;font-size:12px;font-weight:500;">Hours</th>
                      <th style="padding:8px;font-size:12px;font-weight:500;">Rate / hr</th>
                      <th style="padding:8px;font-size:12px;font-weight:500;text-align:right;">Amount</th>
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
                <table style="width:100%;min-width:560px;border-collapse:collapse;">
                  <thead>
                    <tr style="border-bottom:1px solid #e2e8f0;text-align:left;color:#64748b;">
                      <th style="padding:8px;font-size:12px;font-weight:500;">Part used</th>
                      <th style="padding:8px;font-size:12px;font-weight:500;">Qty</th>
                      <th style="padding:8px;font-size:12px;font-weight:500;">Rate</th>
                      <th style="padding:8px;font-size:12px;font-weight:500;text-align:right;">Amount</th>
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

export function renderInvoiceDocumentHtml(
  invoice: InvoiceDocumentModel,
  options: { logoSrc?: string } = {},
) {
  const logoSrc = options.logoSrc ?? INVOICE_LOGO_DATA_URL;
  const invoiceSummary = summarizeServices(invoice.services);
  const amountRemaining = Math.max(invoice.amountRemaining ?? invoice.total ?? 0, 0);
  const lineItemsTable = renderInvoiceLineItemsTable(invoice.services);
  const mechanicName = 'M Rico';
  const mechanicPhone = '(347) 730-3281';
  const mechanicEmail = 'billing@gmbworkshop.shop';
  const mechanicAddress = '255-17 Hillside Ave, Queens, NY 11004';

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
      .header-top {
        display: table;
        width: 100%;
        table-layout: fixed;
      }
      .header-left,
      .header-right {
        display: table-cell;
        vertical-align: top;
      }
      .header-right {
        text-align: left;
        width: 48%;
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
        .header-top,
        .meta-grid,
        .note-grid {
          display: block !important;
        }
        .header-left,
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
          <div class="header-top">
            <div class="header-left">
              <div style="display:inline-flex;border:1px solid #e2e8f0;background:rgba(248,250,252,0.7);padding:8px 12px;border-radius:6px;box-shadow:0 1px 2px rgba(15,23,42,0.06);">
                ${renderInvoiceLogo({
                  src: logoSrc,
                  alt: 'Rico Logo',
                  maxWidth: 220,
                  marginBottom: 0,
                })}
              </div>
            </div>
            <div class="header-right">
              <p style="margin:0;font-size:14px;font-weight:600;color:#0f172a;">${escapeHtml(mechanicName)}</p>
              <p style="margin:2px 0 0;font-size:12px;color:#475569;">${escapeHtml(mechanicPhone)}</p>
              <p style="margin:2px 0 0;font-size:12px;color:#475569;">${escapeHtml(mechanicEmail)}</p>
              <p style="margin:2px 0 0;font-size:12px;color:#475569;">${escapeHtml(mechanicAddress)}</p>
            </div>
          </div>
          <p style="margin:8px 0 0;font-size:12px;font-weight:600;letter-spacing:0.2em;text-transform:uppercase;color:#64748b;">INVOICE</p>
          <p style="margin:4px 0 0;font-size:24px;line-height:1.15;font-weight:800;color:#0f172a;">${escapeHtml(invoice.title)}</p>
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
            <p style="margin:0;font-size:12px;font-weight:500;letter-spacing:0.06em;text-transform:uppercase;color:#64748b;">Document No.</p>
            <p style="margin:4px 0 0;font-size:14px;font-weight:600;color:#0f172a;">${escapeHtml(invoice.estimateNumber)}</p>
            <p style="margin:2px 0 0;font-size:12px;color:#475569;">${escapeHtml(invoice.vehicleLabel)}</p>
          </div>
        </div>

        <div style="border-top:1px solid #e2e8f0;margin-top:20px;padding-top:16px;" class="note-grid">
          <div class="note-col" style="padding-right:12px;">
            <p style="margin:0;font-size:14px;font-weight:600;color:#0f172a;">Customer Comment</p>
            <p style="margin:4px 0 0;font-size:12px;color:#334155;white-space:pre-line;">${escapeHtml(
              invoice.customerComment ?? '—',
            )}</p>
          </div>
          <div class="note-col-right" style="padding-left:12px;">
            <p style="margin:0;font-size:14px;font-weight:600;color:#0f172a;">Recommendation</p>
            <p style="margin:4px 0 0;font-size:12px;color:#334155;white-space:pre-line;">${escapeHtml(
              invoice.recommendation ?? '—',
            )}</p>
          </div>
        </div>

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
