import {
  Body,
  Controller,
  Get,
  Header,
  Headers,
  Param,
  Post,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { PublicSignEstimateDto } from '../estimates/dto/public-sign-estimate.dto';
import { DocumentPresentationService } from './document-presentation.service';
import { PublicEstimateRateLimitGuard } from './public-estimate-rate-limit.guard';

@Controller('public/estimates')
@UseGuards(PublicEstimateRateLimitGuard)
export class PublicEstimatesController {
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
    return this.presentationService.getPublicView(token);
  }

  @Get(':token/pdf')
  @Header('Cache-Control', 'private, no-store')
  @Header('X-Robots-Tag', 'noindex, noarchive')
  @Header(
    'Content-Security-Policy',
    "default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'; script-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
  )
  @Header('X-Content-Type-Options', 'nosniff')
  @Header('Referrer-Policy', 'no-referrer')
  @Header('Content-Type', 'application/pdf')
  async getPdf(@Param('token') token: string, @Res() response: Response) {
    const file = await this.presentationService.getPublicPdf(token);
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

  @Post(':token/approve')
  @Header('Cache-Control', 'private, no-store')
  @Header('X-Robots-Tag', 'noindex, noarchive')
  @Header(
    'Content-Security-Policy',
    "default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'; script-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
  )
  @Header('X-Content-Type-Options', 'nosniff')
  @Header('Referrer-Policy', 'no-referrer')
  approve(
    @Param('token') token: string,
    @Req() request: Request,
    @Headers('user-agent') userAgent?: string,
  ) {
    return this.presentationService.approvePublic(
      token,
      this.requestMeta(request, userAgent),
    );
  }

  @Post(':token/decline')
  @Header('Cache-Control', 'private, no-store')
  @Header('X-Robots-Tag', 'noindex, noarchive')
  @Header(
    'Content-Security-Policy',
    "default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'; script-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
  )
  @Header('X-Content-Type-Options', 'nosniff')
  @Header('Referrer-Policy', 'no-referrer')
  decline(
    @Param('token') token: string,
    @Req() request: Request,
    @Headers('user-agent') userAgent?: string,
  ) {
    return this.presentationService.declinePublic(
      token,
      this.requestMeta(request, userAgent),
    );
  }

  @Post(':token/sign')
  @Header('Cache-Control', 'private, no-store')
  @Header('X-Robots-Tag', 'noindex, noarchive')
  @Header(
    'Content-Security-Policy',
    "default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'; script-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
  )
  @Header('X-Content-Type-Options', 'nosniff')
  @Header('Referrer-Policy', 'no-referrer')
  sign(
    @Param('token') token: string,
    @Body() payload: PublicSignEstimateDto,
    @Req() request: Request,
    @Headers('user-agent') userAgent?: string,
  ) {
    return this.presentationService.signPublic(
      token,
      payload,
      this.requestMeta(request, userAgent),
    );
  }

  private requestMeta(request: Request, userAgent?: string) {
    const forwarded = request.headers['x-forwarded-for'];
    const ip =
      typeof forwarded === 'string' && forwarded.trim()
        ? (forwarded.split(',')[0]?.trim() ?? null)
        : (request.ip ?? null);
    return {
      ipAddress: ip,
      userAgent: userAgent?.slice(0, 500) ?? null,
    };
  }
}
