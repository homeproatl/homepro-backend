import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../auth/guards/auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentActor } from '../common/decorators/current-actor.decorator';
import { UserRole } from '../common/enums/user-role.enum';
import type { AuthActor } from '../common/types/auth-actor';
import { StripePaymentsService } from './stripe-payments.service';

@Controller('payments')
@UseGuards(AuthGuard, RolesGuard)
export class PaymentsController {
  constructor(private readonly stripePayments: StripePaymentsService) {}

  @Get()
  @Roles(UserRole.ADMIN, UserRole.TECHNICIAN)
  findAll(
    @Query() query: Record<string, unknown>,
    @CurrentActor() actor: AuthActor,
  ) {
    return this.stripePayments.listPayments(actor, query);
  }

  @Get(':id')
  @Roles(UserRole.ADMIN, UserRole.TECHNICIAN)
  findOne(@Param('id') id: string, @CurrentActor() actor: AuthActor) {
    return this.stripePayments.getPayment(id, actor);
  }
}
