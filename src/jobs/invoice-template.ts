export type InvoiceDocumentLineItem = {
  description: string;
  quantity: number;
  unitPrice: number;
  subTotal: number;
};

export type InvoiceDocumentModel = {
  invoiceNumber: string;
  jobNumber: string;
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
  services: InvoiceDocumentLineItem[];
  parts: InvoiceDocumentLineItem[];
  mode: 'preview' | 'issued';
};

export type InvoiceEmailMessageModel = {
  invoiceNumber: string;
  customerName: string;
  jobNumber: string;
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

export function renderInvoiceDocumentHtml(invoice: InvoiceDocumentModel) {
  const paymentStatusLabel = formatPaymentStatusLabel(invoice.paymentStatus);
  const servicesRows = invoice.services
    .map(
      (line) => `
        <tr>
          <td style="padding:10px 12px;border-top:1px solid #e4e4e7;">${escapeHtml(line.description)}</td>
          <td style="padding:10px 12px;border-top:1px solid #e4e4e7;text-align:right;">${line.quantity}</td>
          <td style="padding:10px 12px;border-top:1px solid #e4e4e7;text-align:right;">${formatCurrency(line.unitPrice)}</td>
          <td style="padding:10px 12px;border-top:1px solid #e4e4e7;text-align:right;">${formatCurrency(line.subTotal)}</td>
        </tr>`,
    )
    .join('');
  const partsRows = invoice.parts
    .map(
      (line) => `
        <tr>
          <td style="padding:10px 12px;border-top:1px solid #e4e4e7;">${escapeHtml(line.description)}</td>
          <td style="padding:10px 12px;border-top:1px solid #e4e4e7;text-align:right;">${line.quantity}</td>
          <td style="padding:10px 12px;border-top:1px solid #e4e4e7;text-align:right;">${formatCurrency(line.unitPrice)}</td>
          <td style="padding:10px 12px;border-top:1px solid #e4e4e7;text-align:right;">${formatCurrency(line.subTotal)}</td>
        </tr>`,
    )
    .join('');
  const totalItems = invoice.services.length + invoice.parts.length;

  const footerNote =
    invoice.mode === 'preview'
      ? 'Preview generated from the current job state. Sending this invoice will lock the billing snapshot and attach the same PDF layout.'
      : 'This invoice reflects the billing snapshot and payment status captured for this job.';

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Invoice ${escapeHtml(invoice.invoiceNumber)} from Rico Workshop</title>
    <style>
      :root { color-scheme: light; }
      html, body { margin: 0; padding: 0; }
      body {
        background: #f8fafc;
        color: #111827;
        font-family: Helvetica, Arial, sans-serif;
        -webkit-font-smoothing: antialiased;
      }
      iframe, img { border: 0; }
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
        .invoice-summary {
          max-width: none !important;
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
                  <p style="margin:0;font-size:12px;letter-spacing:0.18em;text-transform:uppercase;color:#52525b;">Rico Workshop</p>
                  <p style="margin:4px 0 0;font-size:14px;color:#71717a;">Service &amp; Repair Billing</p>
                  <h1 style="margin:16px 0 0;font-size:36px;line-height:1.1;font-weight:700;">Service Invoice</h1>
                  <p style="margin:12px 0 0;font-size:16px;color:#52525b;">Job ${escapeHtml(invoice.jobNumber)} · ${escapeHtml(invoice.title)}</p>
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

          <div style="overflow:hidden;border:1px solid #e4e4e7;border-radius:8px;">
            <div style="padding:12px 16px;border-bottom:1px solid #e4e4e7;background:#fafafa;">
              <p style="margin:0;font-size:12px;letter-spacing:0.12em;text-transform:uppercase;color:#71717a;">Services</p>
            </div>
            <table style="width:100%;border-collapse:collapse;font-size:14px;">
              <thead style="background:#f4f4f5;">
                <tr>
                  <th style="padding:10px 12px;text-align:left;font-size:12px;letter-spacing:0.08em;text-transform:uppercase;color:#52525b;">Description</th>
                  <th style="padding:10px 12px;text-align:right;font-size:12px;letter-spacing:0.08em;text-transform:uppercase;color:#52525b;">Qty</th>
                  <th style="padding:10px 12px;text-align:right;font-size:12px;letter-spacing:0.08em;text-transform:uppercase;color:#52525b;">Unit Price</th>
                  <th style="padding:10px 12px;text-align:right;font-size:12px;letter-spacing:0.08em;text-transform:uppercase;color:#52525b;">Subtotal</th>
                </tr>
              </thead>
              <tbody>
                ${
                  servicesRows ||
                  `<tr><td colspan="4" style="padding:14px 12px;border-top:1px solid #e4e4e7;color:#71717a;">No service lines on this invoice.</td></tr>`
                }
              </tbody>
            </table>
          </div>

          <div style="margin-top:16px;overflow:hidden;border:1px solid #e4e4e7;border-radius:8px;">
            <div style="padding:12px 16px;border-bottom:1px solid #e4e4e7;background:#fafafa;">
              <p style="margin:0;font-size:12px;letter-spacing:0.12em;text-transform:uppercase;color:#71717a;">Parts Used</p>
            </div>
            <table style="width:100%;border-collapse:collapse;font-size:14px;">
              <thead style="background:#f4f4f5;">
                <tr>
                  <th style="padding:10px 12px;text-align:left;font-size:12px;letter-spacing:0.08em;text-transform:uppercase;color:#52525b;">Description</th>
                  <th style="padding:10px 12px;text-align:right;font-size:12px;letter-spacing:0.08em;text-transform:uppercase;color:#52525b;">Qty</th>
                  <th style="padding:10px 12px;text-align:right;font-size:12px;letter-spacing:0.08em;text-transform:uppercase;color:#52525b;">Unit Price</th>
                  <th style="padding:10px 12px;text-align:right;font-size:12px;letter-spacing:0.08em;text-transform:uppercase;color:#52525b;">Subtotal</th>
                </tr>
              </thead>
              <tbody>
                ${
                  partsRows ||
                  `<tr><td colspan="4" style="padding:14px 12px;border-top:1px solid #e4e4e7;color:#71717a;">No parts were billed on this invoice.</td></tr>`
                }
              </tbody>
            </table>
          </div>

          <div style="margin-top:24px;text-align:right;">
            <div class="invoice-summary" style="display:inline-block;width:100%;max-width:320px;border:1px solid #d4d4d8;border-radius:8px;background:#fafafa;padding:20px;text-align:left;">
              <p style="margin:0 0 12px;font-size:12px;letter-spacing:0.12em;text-transform:uppercase;color:#71717a;">Summary</p>
              <div style="display:flex;justify-content:space-between;margin-bottom:16px;padding-bottom:16px;border-bottom:1px solid #d4d4d8;font-size:14px;color:#52525b;">
                <span>Billable Items</span>
                <span>${totalItems}</span>
              </div>
              <div style="display:flex;justify-content:space-between;margin-bottom:10px;font-size:14px;color:#52525b;">
                <span>Services</span>
                <span>${invoice.services.length}</span>
              </div>
              <div style="display:flex;justify-content:space-between;margin-bottom:16px;padding-bottom:16px;border-bottom:1px solid #d4d4d8;font-size:14px;color:#52525b;">
                <span>Parts Used</span>
                <span>${invoice.parts.length}</span>
              </div>
              <div style="display:flex;justify-content:space-between;font-size:18px;font-weight:600;">
                <span>Total Due</span>
                <span>${formatCurrency(invoice.total)}</span>
              </div>
            </div>
          </div>

          <p style="margin:24px 0 0;font-size:12px;color:#71717a;">${escapeHtml(footerNote)}</p>
        </div>
      </div>
    </div>
  </body>
</html>`;
}

export function renderInvoiceEmailMessageHtml(
  message: InvoiceEmailMessageModel,
) {
  const customerName = escapeHtml(message.customerName.trim() || 'Customer');
  const dueDate = escapeHtml(formatDate(message.dueDate, message.timeZone));
  const amountDue = escapeHtml(formatCurrency(message.total));
  const invoiceNumber = escapeHtml(message.invoiceNumber);
  const jobNumber = escapeHtml(message.jobNumber);

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Invoice ${invoiceNumber} from Rico Workshop</title>
  </head>
  <body style="margin:0;padding:24px;background:#f8fafc;color:#111827;font-family:Helvetica,Arial,sans-serif;">
    <div style="margin:0 auto;max-width:640px;border:1px solid #e4e4e7;border-radius:8px;background:#ffffff;padding:32px;">
      <p style="margin:0 0 8px;font-size:12px;letter-spacing:0.18em;text-transform:uppercase;color:#52525b;">Rico Workshop</p>
      <h1 style="margin:0 0 20px;font-size:28px;line-height:1.2;">Invoice Attached</h1>
      <p style="margin:0 0 16px;font-size:16px;line-height:1.6;">Dear ${customerName},</p>
      <p style="margin:0 0 16px;font-size:16px;line-height:1.6;">Thank you for choosing Rico Workshop.</p>
      <p style="margin:0 0 20px;font-size:16px;line-height:1.6;">Attached to this email is your invoice <strong>${invoiceNumber}</strong> for job <strong>${jobNumber}</strong>.</p>
      <div style="margin:0 0 20px;border:1px solid #e4e4e7;border-radius:8px;background:#fafafa;padding:18px 20px;">
        <p style="margin:0 0 8px;font-size:14px;color:#52525b;"><strong>Amount due:</strong> ${amountDue}</p>
        <p style="margin:0;font-size:14px;color:#52525b;"><strong>Due date:</strong> ${dueDate}</p>
      </div>
      <p style="margin:0 0 16px;font-size:16px;line-height:1.6;">Please open the attached PDF to review the complete invoice details.</p>
      <p style="margin:0 0 16px;font-size:16px;line-height:1.6;">If you have any questions, please contact us and we will be happy to assist.</p>
      <p style="margin:0;font-size:16px;line-height:1.6;">Kind regards,<br />Rico Workshop</p>
    </div>
  </body>
</html>`;
}
