import {
  Body,
  Controller,
  Get,
  Header,
  Param,
  Patch,
  Post,
  Query,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Response } from 'express';
import { AuthGuard } from '../auth/guards/auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentActor } from '../common/decorators/current-actor.decorator';
import { UserRole } from '../common/enums/user-role.enum';
import type { AuthActor } from '../common/types/auth-actor';
import { ListInvoicesQueryDto } from './dto/list-invoices-query.dto';
import {
  RestoreDocumentDto,
  TransitionDocumentStatusDto,
} from '../documents/dto/transition-document-status.dto';
import { UpdateDocumentDto } from '../documents/dto/update-document.dto';
import { CreateInvoiceDto } from './dto/create-invoice.dto';
import { CreateManualAdjustmentDto } from './dto/create-manual-adjustment.dto';
import { CreateManualPaymentDto } from './dto/create-manual-payment.dto';
import { CreateManualRefundDto } from './dto/create-manual-refund.dto';
import { InvoiceVersionDto } from './dto/invoice-version.dto';
import { SendInvoiceDocumentDto } from './dto/send-invoice-document.dto';
import { UpdateInvoiceLinePurchaseStatusDto } from './dto/update-invoice-line-purchase-status.dto';
import { InvoiceWorkflowService } from './invoice-workflow.service';
import { InvoicesService } from './invoices.service';
import { PaymentsService } from './payments.service';
import { StripePaymentsService } from './stripe-payments.service';

/**
 * First-class invoice facade over the shared documents aggregate.
 */
@Controller('invoices')
@UseGuards(AuthGuard, RolesGuard)
export class InvoicesController {
  constructor(
    private readonly invoicesService: InvoicesService,
    private readonly invoiceWorkflow: InvoiceWorkflowService,
    private readonly paymentsService: PaymentsService,
    private readonly stripePaymentsService: StripePaymentsService,
  ) {}

  @Post()
  @Roles(UserRole.ADMIN, UserRole.TECHNICIAN)
  create(@Body() payload: CreateInvoiceDto, @CurrentActor() actor: AuthActor) {
    return this.invoicesService.create(payload, actor);
  }

  @Get()
  @Roles(UserRole.ADMIN, UserRole.TECHNICIAN)
  findAll(
    @Query() query: ListInvoicesQueryDto,
    @CurrentActor() actor: AuthActor,
  ) {
    return this.invoicesService.findAll(query, actor.organization_id);
  }

  @Get(':id/preview')
  @Roles(UserRole.ADMIN, UserRole.TECHNICIAN)
  getPreview(@Param('id') id: string, @CurrentActor() actor: AuthActor) {
    return this.invoiceWorkflow.getPreview(id, actor);
  }

  @Get(':id/pdf')
  @Roles(UserRole.ADMIN, UserRole.TECHNICIAN)
  @Header('Content-Type', 'application/pdf')
  async getPdf(
    @Param('id') id: string,
    @CurrentActor() actor: AuthActor,
    @Res() response: Response,
  ) {
    const file = await this.invoiceWorkflow.getPdf(id, actor);
    response.setHeader(
      'Content-Disposition',
      `inline; filename="${file.fileName}"`,
    );
    response.send(file.buffer);
  }

  @Get(':id/latest')
  @Roles(UserRole.ADMIN, UserRole.TECHNICIAN)
  getLatest(@Param('id') id: string, @CurrentActor() actor: AuthActor) {
    return this.invoiceWorkflow.getLatest(id, actor);
  }

  @Get(':id/history')
  @Roles(UserRole.ADMIN, UserRole.TECHNICIAN)
  getHistory(@Param('id') id: string, @CurrentActor() actor: AuthActor) {
    return this.invoiceWorkflow.getHistory(id, actor);
  }

  @Get(':id/payments')
  @Roles(UserRole.ADMIN, UserRole.TECHNICIAN)
  getPayments(@Param('id') id: string, @CurrentActor() actor: AuthActor) {
    return this.paymentsService.getPaymentsForDocument(
      id,
      actor.organization_id,
    );
  }

  @Get(':id')
  @Roles(UserRole.ADMIN, UserRole.TECHNICIAN)
  findById(@Param('id') id: string, @CurrentActor() actor: AuthActor) {
    return this.invoicesService.findById(id, actor);
  }

  @Patch(':id')
  @Roles(UserRole.ADMIN, UserRole.TECHNICIAN)
  async update(
    @Param('id') id: string,
    @Body() payload: UpdateDocumentDto,
    @CurrentActor() actor: AuthActor,
  ) {
    await this.stripePaymentsService.prepareForInvoiceMutation(id, actor);
    return this.invoicesService.update(id, payload, actor);
  }

  @Patch(':id/line-purchase-status')
  @Roles(UserRole.ADMIN)
  updateLinePurchaseStatus(
    @Param('id') id: string,
    @Body() payload: UpdateInvoiceLinePurchaseStatusDto,
    @CurrentActor() actor: AuthActor,
  ) {
    return this.invoicesService.updateLinePurchaseStatuses(
      id,
      payload.version,
      payload.updates,
      actor,
    );
  }

  @Patch(':id/status')
  @Roles(UserRole.ADMIN, UserRole.TECHNICIAN)
  async transitionStatus(
    @Param('id') id: string,
    @Body() payload: TransitionDocumentStatusDto,
    @CurrentActor() actor: AuthActor,
  ) {
    await this.stripePaymentsService.prepareForInvoiceMutation(id, actor);
    return this.invoicesService.transitionStatus(id, payload, actor);
  }

  @Patch(':id/restore')
  @Roles(UserRole.ADMIN, UserRole.TECHNICIAN)
  restore(
    @Param('id') id: string,
    @Body() payload: RestoreDocumentDto,
    @CurrentActor() actor: AuthActor,
  ) {
    return this.invoicesService.restore(id, payload, actor);
  }

  @Post(':id/issue')
  @Roles(UserRole.ADMIN, UserRole.TECHNICIAN)
  issue(
    @Param('id') id: string,
    @Body() payload: InvoiceVersionDto,
    @CurrentActor() actor: AuthActor,
  ) {
    return this.invoiceWorkflow.issue(id, actor, payload.version);
  }

  @Post(':id/send')
  @Roles(UserRole.ADMIN, UserRole.TECHNICIAN)
  send(
    @Param('id') id: string,
    @Body() payload: SendInvoiceDocumentDto,
    @CurrentActor() actor: AuthActor,
  ) {
    return this.invoiceWorkflow.send(id, actor, payload);
  }

  @Post(':id/void')
  @Roles(UserRole.ADMIN)
  voidInvoice(
    @Param('id') id: string,
    @Body() payload: InvoiceVersionDto,
    @CurrentActor() actor: AuthActor,
  ) {
    return this.invoiceWorkflow.voidInvoice(id, actor, payload.version);
  }

  @Post(':id/duplicate')
  @Roles(UserRole.ADMIN, UserRole.TECHNICIAN)
  duplicate(@Param('id') id: string, @CurrentActor() actor: AuthActor) {
    return this.invoiceWorkflow.duplicate(id, actor);
  }

  @Post(':id/access-grants')
  @Roles(UserRole.ADMIN)
  createAccessGrant(@Param('id') id: string, @CurrentActor() actor: AuthActor) {
    return this.invoiceWorkflow.createAccessGrant(id, actor);
  }

  @Post(':id/access-grants/rotate')
  @Roles(UserRole.ADMIN)
  rotateAccessGrant(@Param('id') id: string, @CurrentActor() actor: AuthActor) {
    return this.invoiceWorkflow.rotateAccessGrant(id, actor);
  }

  @Post(':id/manual-payments')
  @Roles(UserRole.ADMIN, UserRole.TECHNICIAN)
  async recordManualPayment(
    @Param('id') id: string,
    @Body() payload: CreateManualPaymentDto,
    @CurrentActor() actor: AuthActor,
  ) {
    await this.stripePaymentsService.prepareForInvoiceMutation(id, actor);
    return this.paymentsService.recordManualPayment(id, payload, actor);
  }

  @Post(':id/manual-refunds')
  @Roles(UserRole.ADMIN)
  recordManualRefund(
    @Param('id') id: string,
    @Body() payload: CreateManualRefundDto,
    @CurrentActor() actor: AuthActor,
  ) {
    return this.paymentsService.recordManualRefund(id, payload, actor);
  }

  @Post(':id/manual-adjustments')
  @Roles(UserRole.ADMIN)
  recordManualAdjustment(
    @Param('id') id: string,
    @Body() payload: CreateManualAdjustmentDto,
    @CurrentActor() actor: AuthActor,
  ) {
    return this.paymentsService.recordManualAdjustment(id, payload, actor);
  }
}
