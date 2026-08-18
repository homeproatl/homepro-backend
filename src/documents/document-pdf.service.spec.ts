import { existsSync } from 'node:fs';
import { resolvePdfBrowserExecutablePath } from './document-pdf.service';

describe('DocumentPdfService browser resolution', () => {
  it('returns an executable browser path when PDF rendering is available', () => {
    const executablePath = resolvePdfBrowserExecutablePath();

    expect(executablePath).toBeDefined();
    expect(existsSync(executablePath!)).toBe(true);
  });
});
