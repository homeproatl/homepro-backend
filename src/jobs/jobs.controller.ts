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
import { Roles } from '../auth/decorators/roles.decorator';
import { RolesGuard } from '../auth/guards/roles.guard';
import { UserRole } from '../common/enums/user-role.enum';
import { JobsService } from './jobs.service';
import { CreateJobDto } from './dto/create-job.dto';
import { UpdateJobDto } from './dto/update-job.dto';
import { UpdateJobStatusDto } from './dto/update-job-status.dto';
import { UpdateJobPaymentStatusDto } from './dto/update-job-payment-status.dto';
import { CreateJobPartDto } from './dto/create-job-part.dto';
import { UpdateJobPartDto } from './dto/update-job-part.dto';
import { CreateJobServiceDto } from './dto/create-job-service.dto';
import { UpdateJobServiceDto } from './dto/update-job-service.dto';
import { CalendarJobsQueryDto } from './dto/calendar-jobs-query.dto';
import { ListJobsQueryDto } from './dto/list-jobs-query.dto';

@Controller('jobs')
@UseGuards(AuthGuard, RolesGuard)
export class JobsController {
  constructor(private readonly jobsService: JobsService) {}

  @Post()
  create(@Body() payload: CreateJobDto, @Req() request: AuthenticatedRequest) {
    return this.jobsService.create(payload, request.user?.sub);
  }

  @Get()
  findAll(@Query() query: ListJobsQueryDto) {
    return this.jobsService.findAll(query);
  }

  @Get('calendar')
  calendar(@Query() query: CalendarJobsQueryDto) {
    return this.jobsService.calendar(query);
  }

  @Get(':id/invoice-preview')
  getInvoicePreview(@Param('id') id: string) {
    return this.jobsService.getInvoicePreview(id);
  }

  @Get(':id/invoice-latest')
  getLatestInvoice(@Param('id') id: string) {
    return this.jobsService.getLatestInvoice(id);
  }

  @Get(':id/invoice-history')
  getInvoiceHistory(@Param('id') id: string) {
    return this.jobsService.getInvoiceHistory(id);
  }

  @Get(':id/invoice-pdf')
  @Header('Content-Type', 'application/pdf')
  async getInvoicePdf(@Param('id') id: string, @Res() response: Response) {
    const file = await this.jobsService.getInvoicePdf(id);
    response.setHeader(
      'Content-Disposition',
      `inline; filename="${file.fileName}"`,
    );
    response.send(file.buffer);
  }

  @Get(':id')
  findById(@Param('id') id: string) {
    return this.jobsService.findById(id);
  }

  @Delete(':id')
  @Roles(UserRole.SUPER_ADMIN)
  remove(@Param('id') id: string, @Req() request: AuthenticatedRequest) {
    return this.jobsService.remove(id, request.user?.sub);
  }

  @Patch(':id')
  update(
    @Param('id') id: string,
    @Body() payload: UpdateJobDto,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.jobsService.update(id, payload, request.user?.sub);
  }

  @Patch(':id/status')
  updateStatus(
    @Param('id') id: string,
    @Body() payload: UpdateJobStatusDto,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.jobsService.updateStatus(id, payload, request.user?.sub);
  }

  @Patch(':id/payment-status')
  updatePaymentStatus(
    @Param('id') id: string,
    @Body() payload: UpdateJobPaymentStatusDto,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.jobsService.updatePaymentStatus(id, payload, request.user?.sub);
  }

  @Post(':id/parts')
  addPart(
    @Param('id') id: string,
    @Body() payload: CreateJobPartDto,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.jobsService.addPart(id, payload, request.user?.sub);
  }

  @Patch(':id/parts/:partId')
  updatePart(
    @Param('id') id: string,
    @Param('partId') partId: string,
    @Body() payload: UpdateJobPartDto,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.jobsService.updatePart(id, partId, payload, request.user?.sub);
  }

  @Delete(':id/parts/:partId')
  removePart(
    @Param('id') id: string,
    @Param('partId') partId: string,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.jobsService.removePart(id, partId, request.user?.sub);
  }

  @Post(':id/services')
  addService(
    @Param('id') id: string,
    @Body() payload: CreateJobServiceDto,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.jobsService.addService(id, payload, request.user?.sub);
  }

  @Patch(':id/services/:jobServiceId')
  updateService(
    @Param('id') id: string,
    @Param('jobServiceId') jobServiceId: string,
    @Body() payload: UpdateJobServiceDto,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.jobsService.updateService(
      id,
      jobServiceId,
      payload,
      request.user?.sub,
    );
  }

  @Delete(':id/services/:jobServiceId')
  removeService(
    @Param('id') id: string,
    @Param('jobServiceId') jobServiceId: string,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.jobsService.removeService(id, jobServiceId, request.user?.sub);
  }

  @Post(':id/invoice-issue')
  issueInvoice(@Param('id') id: string, @Req() request: AuthenticatedRequest) {
    return this.jobsService.issueInvoice(id, request.user?.sub);
  }

  @Post(':id/send-invoice')
  sendInvoice(@Param('id') id: string, @Req() request: AuthenticatedRequest) {
    return this.jobsService.sendInvoice(id, request.user?.sub);
  }
}
