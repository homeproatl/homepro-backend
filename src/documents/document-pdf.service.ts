import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { existsSync } from 'node:fs';
import puppeteer, { type Browser } from 'puppeteer';
import type { DocumentRendererModel } from './document-renderer';
import { renderDocumentHtml } from './document-pdf-template';

const SYSTEM_CHROME_PATHS = [
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  '/usr/bin/google-chrome',
  '/usr/bin/google-chrome-stable',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
] as const;

export function resolvePdfBrowserExecutablePath(): string | undefined {
  const managedPath = puppeteer.executablePath();
  if (managedPath && existsSync(managedPath)) {
    return managedPath;
  }
  return SYSTEM_CHROME_PATHS.find((path) => existsSync(path));
}

@Injectable()
export class DocumentPdfService implements OnModuleDestroy {
  private readonly logger = new Logger(DocumentPdfService.name);
  private browserPromise: Promise<Browser> | null = null;

  async onModuleDestroy() {
    if (!this.browserPromise) {
      return;
    }
    const browser = await this.browserPromise.catch(() => null);
    this.browserPromise = null;
    await browser?.close().catch(() => undefined);
  }

  async renderPdf(model: DocumentRendererModel): Promise<{
    buffer: Buffer;
    fileName: string;
  }> {
    const html = renderDocumentHtml(model);
    const browser = await this.getBrowser();
    const page = await browser.newPage();
    try {
      await page.setContent(html, {
        waitUntil: 'domcontentloaded',
        timeout: 15_000,
      });
      await page.evaluate(async () => {
        await Promise.all(
          Array.from(document.images).map((image) => {
            if (image.complete) return Promise.resolve();
            return new Promise<void>((resolve) => {
              image.addEventListener('load', () => resolve(), { once: true });
              image.addEventListener('error', () => resolve(), { once: true });
            });
          }),
        );
        await document.fonts?.ready;
      });
      const pdf = await page.pdf({
        format: 'Letter',
        printBackground: true,
        margin: {
          top: '0.5in',
          right: '0.5in',
          bottom: '0.5in',
          left: '0.5in',
        },
      });
      return {
        buffer: Buffer.from(pdf),
        fileName: `${model.number}.pdf`,
      };
    } finally {
      await page.close().catch(() => undefined);
    }
  }

  private getBrowser() {
    if (!this.browserPromise) {
      const executablePath = resolvePdfBrowserExecutablePath();
      if (!executablePath) {
        throw new Error(
          'PDF browser is unavailable. Install Chrome or run `npx puppeteer browsers install chrome` in Backend.',
        );
      }
      this.browserPromise = puppeteer
        .launch({
          headless: true,
          executablePath,
          args: ['--no-sandbox', '--disable-setuid-sandbox'],
        })
        .catch((error) => {
          this.browserPromise = null;
          this.logger.error('Failed to launch PDF browser', error);
          throw error;
        });
    }
    return this.browserPromise;
  }
}
