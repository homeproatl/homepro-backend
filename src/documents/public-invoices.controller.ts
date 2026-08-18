import { Controller, Get, Header, Param, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import { DocumentPresentationService } from './document-presentation.service';
import { PublicEstimateRateLimitGuard } from './public-estimate-rate-limit.guard';

/**
 * Public invoice links are view/download only (Step 12).
 * Stripe pay CTAs arrive in Step 14 — do not expose approve/pay here.
 */
@Controller('public/invoices')
@UseGuards(PublicEstimateRateLimitGuard)
export class PublicInvoicesController {
  constructor(
    private readonly presentationService: DocumentPresentationService,
  ) {}

  @Get(':token')
  @Header('Cache-Control', 'private, no-store')
  @Header('X-Robots-Tag', 'noindex, noarchive')
  @Header(
    'Content-Security-Policy',
    "default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'; script-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
  )
  @Header('X-Content-Type-Options', 'nosniff')
  @Header('Referrer-Policy', 'no-referrer')
  getView(@Param('token') token: string) {
    return this.presentationService.getPublicInvoiceView(token);
  }

  @Get(':token/pdf')
  @Header('Cache-Control', 'private, no-store')
  @Header('X-Robots-Tag', 'noindex, noarchive')
  @Header('Content-Type', 'application/pdf')
  async getPdf(@Param('token') token: string, @Res() response: Response) {
    const file = await this.presentationService.getPublicInvoicePdf(token);
    response.setHeader(
      'Content-Disposition',
      `inline; filename="${file.fileName}"`,
    );
    response.send(file.buffer);
  }

  @Get(':token/assets/:assetId')
  @Header('Cache-Control', 'private, no-store')
  @Header('X-Robots-Tag', 'noindex, noarchive')
  @Header('X-Content-Type-Options', 'nosniff')
  async getAsset(
    @Param('token') token: string,
    @Param('assetId') assetId: string,
    @Res() response: Response,
  ) {
    const file = await this.presentationService.getPublicAsset(token, assetId);
    response.setHeader('Content-Type', file.asset.mime_type);
    response.setHeader(
      'Content-Disposition',
      `${file.asset.kind === 'attachment' ? 'attachment' : 'inline'}; filename="${file.asset.filename.replace(/["\r\n\\/]/g, '_')}"`,
    );
    response.send(file.buffer);
  }
}
