import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { AuthActor } from '../common/types/auth-actor';
import { UserRole } from '../common/enums/user-role.enum';
import {
  ESTIMATE_STATUSES,
  type EstimateStatus,
} from '../documents/document-status';
import { DocumentAutomationJobService } from '../documents/document-automation-job.service';
import { DocumentsService } from '../documents/documents.service';
import type { CreateDocumentDto } from '../documents/dto/create-document.dto';
import { ListEstimateDocumentsQueryDto } from '../documents/dto/list-estimate-documents-query.dto';
import {
  RestoreDocumentDto,
  TransitionDocumentStatusDto,
} from '../documents/dto/transition-document-status.dto';
import type { ConvertEstimateToInvoiceDto } from '../invoices/dto/convert-estimate-to-invoice.dto';
import { EstimateConversionService } from '../invoices/estimate-conversion.service';
import type { CreateEstimateDocumentDto } from './dto/create-estimate-document.dto';
import type { UpdateEstimateDocumentDto } from './dto/update-estimate-document.dto';
import type { UpdateEstimateLinePurchaseStatusDto } from './dto/update-estimate-line-purchase-status.dto';
import type { ListEstimatesQueryDto } from './dto/list-estimates-query.dto';

export type CreateEstimateDocumentPayload = CreateEstimateDocumentDto;

/**
 * Thin estimate facade over the shared documents aggregate.
 * Step 8 list (`GET /estimates?paginated=true`) uses findSummariesPage.
 * Step 9 create/edit routes use document-backed aggregates.
 * Step 11 conversion + auto-generate enqueue live here.
 */
@Injectable()
export class DocumentEstimatesFacade {
  constructor(
    private readonly documentsService: DocumentsService,
    private readonly conversionService: EstimateConversionService,
    private readonly automationJobs: DocumentAutomationJobService,
  ) {}

  async create(payload: CreateEstimateDocumentPayload, actor: AuthActor) {
    const documentPayload: CreateDocumentDto = {
      ...payload,
      type: 'estimate',
      // Technicians cannot seed private notes via create.
      private_notes:
        actor.role === UserRole.ADMIN ? payload.private_notes : null,
    };
    const created = await this.documentsService.create(
      documentPayload,
      actor.organization_id,
      actor.user_id,
    );
    return this.serializeForActor(created.id, actor);
  }

  findSummariesPage(query: ListEstimatesQueryDto, organizationId: string) {
    return this.documentsService.findEstimateSummariesPage(
      this.toDocumentListQuery(query),
      organizationId,
    );
  }

  async findById(id: string, actor: AuthActor) {
    await this.requireEstimate(id, actor.organization_id);
    return this.serializeForActor(id, actor);
  }

  async findForEdit(id: string, actor: AuthActor) {
    await this.requireEstimate(id, actor.organization_id);
    return this.serializeForActor(id, actor);
  }

  async update(
    id: string,
    payload: UpdateEstimateDocumentDto,
    actor: AuthActor,
  ) {
    await this.requireEstimate(id, actor.organization_id);
    const includeInternalFields = actor.role === UserRole.ADMIN;
    await this.documentsService.update(
      id,
      payload,
      actor.organization_id,
      actor.user_id,
      { includeInternalFields },
    );
    return this.serializeForActor(id, actor);
  }

  async updateLinePurchaseStatuses(
    id: string,
    payload: UpdateEstimateLinePurchaseStatusDto,
    actor: AuthActor,
  ) {
    await this.requireEstimate(id, actor.organization_id);
    await this.documentsService.updateLinePurchaseStatuses(
      id,
      payload.version,
      payload.updates,
      actor.organization_id,
      actor.user_id,
    );
    return this.serializeForActor(id, actor);
  }

  async transitionStatus(
    id: string,
    payload: TransitionDocumentStatusDto,
    actor: AuthActor,
  ) {
    await this.requireEstimate(id, actor.organization_id);
    await this.documentsService.transitionStatus(
      id,
      payload,
      actor.organization_id,
      actor.user_id,
    );

    if (payload.status === 'approved') {
      const entity = await this.documentsService.findDocumentEntity(
        id,
        actor.organization_id,
      );
      if (entity.auto_generate_invoice_enabled === true) {
        await this.automationJobs.enqueueAutoConversionJob(entity);
      }
    }

    return this.serializeForActor(id, actor);
  }

  async convertToInvoice(
    id: string,
    dto: ConvertEstimateToInvoiceDto | undefined,
    actor: AuthActor,
  ) {
    await this.requireEstimate(id, actor.organization_id);
    return this.conversionService.convertToInvoice(id, dto, actor);
  }

  async listAutomationJobs(id: string, actor: AuthActor) {
    await this.requireEstimate(id, actor.organization_id);
    const jobs = await this.automationJobs.listForEstimate(
      id,
      actor.organization_id,
    );
    return jobs.map((job) => ({
      id: String(job._id),
      estimate_id: String(job.estimate_id),
      job_type: job.job_type,
      status: job.status,
      attempts: job.attempts,
      next_attempt_at: job.next_attempt_at?.toISOString?.() ?? null,
      last_error: job.last_error,
      frozen_version: job.frozen_version,
      frozen_hash: job.frozen_hash,
      created_at: job.created_at?.toISOString?.() ?? null,
      updated_at: job.updated_at?.toISOString?.() ?? null,
    }));
  }

  async retryAutomationJob(id: string, jobId: string, actor: AuthActor) {
    await this.requireEstimate(id, actor.organization_id);
    const job = await this.automationJobs.retryFailed(
      jobId,
      actor.organization_id,
    );
    // Kick the worker promptly after manual retry.
    void this.automationJobs.processPendingJobs();
    return {
      id: String(job._id),
      status: job.status,
      next_attempt_at: job.next_attempt_at?.toISOString?.() ?? null,
      last_error: job.last_error,
    };
  }

  async archive(id: string, version: number, actor: AuthActor) {
    return this.transitionStatus(id, { status: 'archived', version }, actor);
  }

  async restore(id: string, payload: RestoreDocumentDto, actor: AuthActor) {
    await this.requireEstimate(id, actor.organization_id);
    await this.documentsService.restoreArchived(
      id,
      payload,
      actor.organization_id,
      actor.user_id,
    );
    return this.serializeForActor(id, actor);
  }

  private async requireEstimate(id: string, organizationId: string) {
    const doc = await this.documentsService.findById(id, organizationId);
    if (doc.type !== 'estimate') {
      throw new NotFoundException('Estimate document not found');
    }
    return doc;
  }

  private async serializeForActor(id: string, actor: AuthActor) {
    const entity = await this.documentsService.findDocumentEntity(
      id,
      actor.organization_id,
    );
    return this.documentsService.serializeForEdit(entity, {
      includeInternalFields: actor.role === UserRole.ADMIN,
    });
  }

  private toDocumentListQuery(
    query: ListEstimatesQueryDto,
  ): ListEstimateDocumentsQueryDto {
    const statuses = this.parseEstimateStatuses(query.status);
    return {
      status: statuses,
      client_id: query.client_id,
      search: query.search,
      date_from: query.date_from,
      date_to: query.date_to,
      amount_min_minor: query.amount_min_minor,
      amount_max_minor: query.amount_max_minor,
      email_state: query.email_state,
      sort:
        query.sort === 'issue_date' ||
        query.sort === 'total_minor' ||
        query.sort === 'number' ||
        query.sort === 'created_at' ||
        query.sort === 'updated_at'
          ? query.sort
          : undefined,
      direction: query.direction,
      page: query.page,
      page_size: query.page_size,
    };
  }

  private parseEstimateStatuses(
    status: string | string[] | undefined,
  ): EstimateStatus[] | undefined {
    if (status === undefined) {
      return undefined;
    }
    const values = Array.isArray(status) ? status : [status];
    const allowed = ESTIMATE_STATUSES as readonly string[];
    const invalid = values.filter((value) => !allowed.includes(value));
    if (invalid.length > 0) {
      throw new BadRequestException(
        `Invalid estimate status filter: ${invalid.join(', ')}`,
      );
    }
    return values as EstimateStatus[];
  }
}
