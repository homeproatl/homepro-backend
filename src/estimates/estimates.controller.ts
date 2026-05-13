import {
  Body,
  Controller,
  Delete,
  Get,
  Header,
  Param,
  Patch,
  Post,
  Query,
  Res,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { Response } from 'express';
import { AuthGuard } from '../auth/guards/auth.guard';
import type { AuthenticatedRequest } from '../auth/guards/auth.guard';
import { EstimatesService } from './estimates.service';
import { CreateEstimateDto } from './dto/create-estimate.dto';
import { UpdateEstimateDto } from './dto/update-estimate.dto';
import { UpdateEstimateStatusDto } from './dto/update-estimate-status.dto';
import { UpdateEstimatePaymentStatusDto } from './dto/update-estimate-payment-status.dto';
import { CalendarEstimatesQueryDto } from './dto/calendar-estimates-query.dto';
import { ListEstimatesQueryDto } from './dto/list-estimates-query.dto';
import { DashboardSummaryQueryDto } from './dto/dashboard-summary-query.dto';

@Controller('estimates')
@UseGuards(AuthGuard)
export class EstimatesController {
  constructor(private readonly estimatesService: EstimatesService) {}

  @Post()
  create(@Body() payload: CreateEstimateDto, @Req() request: AuthenticatedRequest) {
    return this.estimatesService.create(payload, request.user?.sub);
  }

  @Get()
  findAll(@Query() query: ListEstimatesQueryDto) {
    if (query.paginated) {
      return this.estimatesService.findPage(query);
    }

    return this.estimatesService.findAll(query);
  }

  @Get('dashboard-summary')
  getDashboardSummary(@Query() query: DashboardSummaryQueryDto) {
    return this.estimatesService.getDashboardSummary({
      dateFrom: query.date_from,
      dateTo: query.date_to,
    });
  }

  @Get('calendar')
  calendar(@Query() query: CalendarEstimatesQueryDto) {
    return this.estimatesService.calendar(query);
  }

  @Get(':id/invoice-preview')
  getInvoicePreview(@Param('id') id: string) {
    return this.estimatesService.getInvoicePreview(id);
  }

  @Get(':id/invoice-latest')
  getLatestInvoice(@Param('id') id: string) {
    return this.estimatesService.getLatestInvoice(id);
  }

  @Get(':id/invoice-history')
  getInvoiceHistory(@Param('id') id: string) {
    return this.estimatesService.getInvoiceHistory(id);
  }

  @Get(':id/invoice-pdf')
  @Header('Content-Type', 'application/pdf')
  async getInvoicePdf(@Param('id') id: string, @Res() response: Response) {
    const file = await this.estimatesService.getInvoicePdf(id);
    response.setHeader(
      'Content-Disposition',
      `inline; filename="${file.fileName}"`,
    );
    response.send(file.buffer);
  }

  @Get(':id')
  findById(@Param('id') id: string) {
    return this.estimatesService.findById(id);
  }

  @Delete(':id')
  remove(@Param('id') id: string, @Req() request: AuthenticatedRequest) {
    return this.estimatesService.remove(id, request.user?.sub);
  }

  @Patch(':id')
  update(
    @Param('id') id: string,
    @Body() payload: UpdateEstimateDto,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.estimatesService.update(id, payload, request.user?.sub);
  }

  @Patch(':id/status')
  updateStatus(
    @Param('id') id: string,
    @Body() payload: UpdateEstimateStatusDto,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.estimatesService.updateStatus(id, payload, request.user?.sub);
  }

  @Patch(':id/payment-status')
  updatePaymentStatus(
    @Param('id') id: string,
    @Body() payload: UpdateEstimatePaymentStatusDto,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.estimatesService.updatePaymentStatus(id, payload, request.user?.sub);
  }

  @Post(':id/invoice-issue')
  issueInvoice(@Param('id') id: string, @Req() request: AuthenticatedRequest) {
    return this.estimatesService.issueInvoice(id, request.user?.sub);
  }

  @Post(':id/send-invoice')
  sendInvoice(@Param('id') id: string, @Req() request: AuthenticatedRequest) {
    return this.estimatesService.sendInvoice(id, request.user?.sub);
  }
}
