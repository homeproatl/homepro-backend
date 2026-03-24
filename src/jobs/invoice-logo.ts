import { existsSync, readFileSync } from 'fs';
import { join } from 'path';

export const INVOICE_LOGO_CONTENT_ID = 'invoice-logo@gmbworkshop';
const INVOICE_LOGO_MIME_TYPE = 'image/jpeg';

function resolveInvoiceLogoPath() {
  const candidates = [
    join(__dirname, 'assets', 'invoice-logo.jpg'),
    join(process.cwd(), 'dist', 'src', 'jobs', 'assets', 'invoice-logo.jpg'),
    join(process.cwd(), 'src', 'jobs', 'assets', 'invoice-logo.jpg'),
  ];

  const match = candidates.find((candidate) => existsSync(candidate));
  if (!match) {
    throw new Error('Invoice logo asset is missing from the backend runtime.');
  }

  return match;
}

function loadInvoiceLogoBuffer() {
  return readFileSync(resolveInvoiceLogoPath());
}

export const INVOICE_LOGO_BUFFER = loadInvoiceLogoBuffer();
export const INVOICE_LOGO_DATA_URL = `data:${INVOICE_LOGO_MIME_TYPE};base64,${INVOICE_LOGO_BUFFER.toString('base64')}`;
