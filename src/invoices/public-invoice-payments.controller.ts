import { Controller, Param, Post, UseGuards } from '@nestjs/common';
import { PublicEstimateRateLimitGuard } from '../documents/public-estimate-rate-limit.guard';
import { StripePaymentsService } from './stripe-payments.service';

@Controller('public/invoices')
@UseGuards(PublicEstimateRateLimitGuard)
export class PublicInvoicePaymentsController {
  constructor(private readonly stripePayments: StripePaymentsService) {}

  @Post(':token/checkout')
  createCheckout(@Param('token') token: string) {
    return this.stripePayments.createPublicCheckoutSession(token);
  }
}
