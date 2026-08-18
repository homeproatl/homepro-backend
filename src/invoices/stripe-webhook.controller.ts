import { Controller, Headers, Post, Req } from '@nestjs/common';
import type { Request } from 'express';
import { StripePaymentsService } from './stripe-payments.service';

type RawBodyRequest = Request & {
  rawBody?: Buffer;
};

@Controller('payments/stripe')
export class StripeWebhookController {
  constructor(private readonly stripePayments: StripePaymentsService) {}

  @Post('webhook')
  handleWebhook(
    @Req() request: RawBodyRequest,
    @Headers('stripe-signature') signature: string | undefined,
  ) {
    return this.stripePayments.handleWebhook(
      request.rawBody ?? JSON.stringify(request.body ?? {}),
      signature,
    );
  }
}
