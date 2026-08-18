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
import { DocumentEstimatesFacade } from './document-estimates.facade';
import { ArchiveEstimateDocumentDto } from './dto/archive-estimate-document.dto';
import { CreateEstimateDocumentDto } from './dto/create-estimate-document.dto';
import { CreatePublicGrantDto } from './dto/create-public-grant.dto';
import { ConvertEstimateToInvoiceDto } from '../invoices/dto/convert-estimate-to-invoice.dto';
import { SendEstimateDocumentDto } from './dto/send-estimate-document.dto';
import { UpdateEstimateDocumentDto } from './dto/update-estimate-document.dto';
import { UpdateEstimateLinePurchaseStatusDto } from './dto/update-estimate-line-purchase-status.dto';
import { ListEstimatesQueryDto } from './dto/list-estimates-query.dto';
import { DocumentPresentationService } from '../documents/document-presentation.service';
import {
  RestoreDocumentDto,
  TransitionDocumentStatusDto,
} from '../documents/dto/transition-document-status.dto';

@Controller('estimates')
@UseGuards(AuthGuard, RolesGuard)
export class EstimatesController {
  constructor(
    private readonly documentEstimatesFacade: DocumentEstimatesFacade,
    private readonly documentPresentationService: DocumentPresentationService,
  ) {}

  @Post()
  @Roles(UserRole.ADMIN, UserRole.TECHNICIAN)
  create(
    @Body() payload: CreateEstimateDocumentDto,
    @CurrentActor() actor: AuthActor,
  ) {
    return this.documentEstimatesFacade.create(payload, actor);
  }

  @Get()
  @Roles(UserRole.ADMIN, UserRole.TECHNICIAN)
  findAll(
    @Query() query: ListEstimatesQueryDto,
    @CurrentActor() actor: AuthActor,
  ) {
    return this.documentEstimatesFacade.findSummariesPage(
      query,
      actor.organization_id,
    );
  }

  @Get(':id/edit')
  @Roles(UserRole.ADMIN, UserRole.TECHNICIAN)
  findForEdit(@Param('id') id: string, @CurrentActor() actor: AuthActor) {
    return this.documentEstimatesFacade.findForEdit(id, actor);
  }

  @Get(':id/preview')
  @Roles(UserRole.ADMIN, UserRole.TECHNICIAN)
  getPreview(@Param('id') id: string, @CurrentActor() actor: AuthActor) {
    return this.documentPresentationService.getAdminPreview(id, actor);
  }

  @Get(':id/pdf')
  @Roles(UserRole.ADMIN, UserRole.TECHNICIAN)
  @Header('Content-Type', 'application/pdf')
  async getDocumentPdf(
    @Param('id') id: string,
    @CurrentActor() actor: AuthActor,
    @Res() response: Response,
  ) {
    const file = await this.documentPresentationService.getAdminPdf(id, actor);
    response.setHeader(
      'Content-Disposition',
      `inline; filename="${file.fileName}"`,
    );
    response.send(file.buffer);
  }

  @Post(':id/send')
  @Roles(UserRole.ADMIN, UserRole.TECHNICIAN)
  send(
    @Param('id') id: string,
    @Body() payload: SendEstimateDocumentDto,
    @CurrentActor() actor: AuthActor,
  ) {
    return this.documentPresentationService.sendEstimate(id, actor, payload);
  }

  @Post(':id/convert-to-invoice')
  @Roles(UserRole.ADMIN, UserRole.TECHNICIAN)
  convertToInvoice(
    @Param('id') id: string,
    @Body() payload: ConvertEstimateToInvoiceDto,
    @CurrentActor() actor: AuthActor,
  ) {
    return this.documentEstimatesFacade.convertToInvoice(id, payload, actor);
  }

  @Get(':id/automation-jobs')
  @Roles(UserRole.ADMIN, UserRole.TECHNICIAN)
  listAutomationJobs(
    @Param('id') id: string,
    @CurrentActor() actor: AuthActor,
  ) {
    return this.documentEstimatesFacade.listAutomationJobs(id, actor);
  }

  @Post(':id/automation-jobs/:jobId/retry')
  @Roles(UserRole.ADMIN)
  retryAutomationJob(
    @Param('id') id: string,
    @Param('jobId') jobId: string,
    @CurrentActor() actor: AuthActor,
  ) {
    return this.documentEstimatesFacade.retryAutomationJob(id, jobId, actor);
  }

  @Post(':id/public-grants')
  @Roles(UserRole.ADMIN)
  createPublicGrant(
    @Param('id') id: string,
    @Body() payload: CreatePublicGrantDto,
    @CurrentActor() actor: AuthActor,
  ) {
    return this.documentPresentationService.createPublicGrant(
      id,
      actor,
      payload,
    );
  }

  @Patch(':id/document-status')
  @Roles(UserRole.ADMIN, UserRole.TECHNICIAN)
  transitionDocumentStatus(
    @Param('id') id: string,
    @Body() payload: TransitionDocumentStatusDto,
    @CurrentActor() actor: AuthActor,
  ) {
    return this.documentEstimatesFacade.transitionStatus(id, payload, actor);
  }

  @Patch(':id/restore')
  @Roles(UserRole.ADMIN, UserRole.TECHNICIAN)
  restoreDocument(
    @Param('id') id: string,
    @Body() payload: RestoreDocumentDto,
    @CurrentActor() actor: AuthActor,
  ) {
    return this.documentEstimatesFacade.restore(id, payload, actor);
  }

  @Get(':id')
  @Roles(UserRole.ADMIN, UserRole.TECHNICIAN)
  findById(@Param('id') id: string, @CurrentActor() actor: AuthActor) {
    return this.documentEstimatesFacade.findById(id, actor);
  }

  @Patch(':id')
  @Roles(UserRole.ADMIN, UserRole.TECHNICIAN)
  update(
    @Param('id') id: string,
    @Body() payload: UpdateEstimateDocumentDto,
    @CurrentActor() actor: AuthActor,
  ) {
    return this.documentEstimatesFacade.update(id, payload, actor);
  }

  @Patch(':id/line-purchase-status')
  @Roles(UserRole.ADMIN)
  updateLinePurchaseStatus(
    @Param('id') id: string,
    @Body() payload: UpdateEstimateLinePurchaseStatusDto,
    @CurrentActor() actor: AuthActor,
  ) {
    return this.documentEstimatesFacade.updateLinePurchaseStatuses(
      id,
      payload,
      actor,
    );
  }

  @Patch(':id/archive')
  @Roles(UserRole.ADMIN)
  archive(
    @Param('id') id: string,
    @Body() payload: ArchiveEstimateDocumentDto,
    @CurrentActor() actor: AuthActor,
  ) {
    return this.documentEstimatesFacade.archive(id, payload.version, actor);
  }
}
