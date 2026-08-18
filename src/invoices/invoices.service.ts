import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { UserRole } from '../common/enums/user-role.enum';
import type { AuthActor } from '../common/types/auth-actor';
import { asObjectId } from '../common/utils/object-id';
import { withOrganizationScope } from '../common/utils/organization-scope';
import { DocumentsService } from '../documents/documents.service';
import {
  RestoreDocumentDto,
  TransitionDocumentStatusDto,
} from '../documents/dto/transition-document-status.dto';
import { UpdateDocumentDto } from '../documents/dto/update-document.dto';
import {
  DOCUMENT_FIELD_LIMITS,
  OrgDocument,
  OrgDocumentDocument,
  type PurchaseStatus,
} from '../documents/schemas/document.schema';
import { INVOICE_STATUSES } from '../documents/document-status';
import { SettingsService } from '../settings/settings.service';
import { startOfBusinessCalendarDateUtc } from '../common/utils/business-time';
import { CreateInvoiceDto } from './dto/create-invoice.dto';
import type { ListInvoicesQueryDto } from './dto/list-invoices-query.dto';
import { computeInvoicePaymentDisplay } from './invoice-payment-state';

@Injectable()
export class InvoicesService {
  constructor(
    private readonly documentsService: DocumentsService,
    private readonly settingsService: SettingsService,
    @InjectModel(OrgDocument.name)
    private readonly documentModel: Model<OrgDocumentDocument>,
  ) {}

  create(payload: CreateInvoiceDto, actor: AuthActor) {
    return this.documentsService.create(
      { ...payload, type: 'invoice' },
      actor.organization_id,
      actor.user_id,
    );
  }

  findAll(query: ListInvoicesQueryDto, organizationId: string) {
    return this.findInvoiceSummariesPage(query, organizationId);
  }

  private async findInvoiceSummariesPage(
    query: ListInvoicesQueryDto,
    organizationId: string,
  ) {
    const filter = await this.buildInvoiceListFilter(query, organizationId);
    const requestedPage = query.page ?? 1;
    const pageSize = Math.min(
      query.page_size ?? 25,
      DOCUMENT_FIELD_LIMITS.page_size_max,
    );

    const total = await this.documentModel.countDocuments(filter).exec();
    const pageCount = total === 0 ? 1 : Math.ceil(total / pageSize);
    const page = Math.min(Math.max(requestedPage, 1), pageCount);
    const skip = (page - 1) * pageSize;

    const docs = await this.documentModel
      .find(filter)
      .sort({ updated_at: -1, _id: -1 })
      .skip(skip)
      .limit(pageSize)
      .exec();

    return {
      items: docs.map((doc) =>
        this.documentsService.serializeInvoiceSummary(
          doc,
          computeInvoicePaymentDisplay({
            total_minor: doc.total_minor,
            amount_paid_minor: doc.amount_paid_minor,
            amount_refunded_minor: doc.amount_refunded_minor,
            amount_disputed_minor: doc.amount_disputed_minor,
            balance_due_minor: doc.balance_due_minor,
            due_date: doc.due_date,
            status: doc.status,
          }),
        ),
      ),
      total,
      page,
      page_size: pageSize,
      page_count: pageCount,
    };
  }

  private async buildInvoiceListFilter(
    query: ListInvoicesQueryDto,
    organizationId: string,
  ) {
    const filter: Record<string, unknown> = withOrganizationScope(
      organizationId,
      { type: 'invoice' },
    );

    const statuses = this.parseStatuses(query.status);
    const segment = query.segment ?? 'all';

    if (statuses.length > 0) {
      filter.status = statuses.length === 1 ? statuses[0] : { $in: statuses };
    } else if (segment === 'active') {
      filter.status = { $in: ['issued', 'sent'] };
      filter.balance_due_minor = { $gt: 0 };
    } else if (segment === 'paid') {
      filter.balance_due_minor = { $lte: 0 };
      filter.amount_paid_minor = { $gt: 0 };
      filter.status = { $nin: ['void', 'archived'] };
    } else if (segment === 'overdue') {
      const startOfToday = await this.startOfBusinessLocalToday(organizationId);
      filter.status = { $in: ['issued', 'sent'] };
      filter.balance_due_minor = { $gt: 0 };
      filter.due_date = { $lt: startOfToday };
    }

    if (query.client_id) {
      filter.client_id = asObjectId(query.client_id, 'client id');
    }

    if (query.source_estimate_id) {
      filter.source_estimate_id = asObjectId(
        query.source_estimate_id,
        'source estimate id',
      );
    }

    if (query.search) {
      const tokens = query.search
        .split(/\s+/)
        .map((t) => t.trim())
        .filter(Boolean)
        .slice(0, DOCUMENT_FIELD_LIMITS.search_token_max);
      if (tokens.length > 0) {
        filter.$and = tokens.map((token) => {
          const pattern = new RegExp(this.escapeRegex(token), 'i');
          return {
            $or: [
              { number: pattern },
              { po_number: pattern },
              { job_name: pattern },
              { 'client_snapshot.display_name': pattern },
              { 'client_snapshot.company_name': pattern },
              { 'client_snapshot.phone': pattern },
              { 'client_snapshot.email': pattern },
              { 'service_address_snapshot.street': pattern },
              { 'service_address_snapshot.city': pattern },
              { 'service_address_snapshot.state': pattern },
              { 'service_address_snapshot.postal_code': pattern },
              { 'client_snapshot.service_address.street': pattern },
              { 'client_snapshot.service_address.city': pattern },
              { 'client_snapshot.service_address.state': pattern },
              { 'client_snapshot.service_address.postal_code': pattern },
            ],
          };
        });
      }
    }

    return filter;
  }

  /**
   * Start of "today" in the org business timezone, as a UTC Date suitable for
   * comparing against stored due_date values.
   */
  private async startOfBusinessLocalToday(organizationId: string) {
    const settings = await this.settingsService.getAppSettings(organizationId);
    const timeZone = settings.business_timezone || 'America/New_York';
    return startOfBusinessCalendarDateUtc(new Date(), timeZone);
  }

  private parseStatuses(raw?: string): string[] {
    if (!raw || typeof raw !== 'string') {
      return [];
    }
    const statuses = raw
      .split(',')
      .map((part) => part.trim())
      .filter(Boolean);
    const invalid = statuses.filter(
      (status) => !(INVOICE_STATUSES as readonly string[]).includes(status),
    );
    if (invalid.length > 0) {
      throw new BadRequestException({
        code: 'INVALID_INVOICE_STATUS_FILTER',
        message: `Unsupported invoice status filter: ${invalid.join(', ')}`,
        allowed_statuses: INVOICE_STATUSES,
      });
    }
    return statuses;
  }

  private escapeRegex(value: string) {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  async findById(id: string, actor: AuthActor) {
    const doc = await this.documentsService.findById(
      id,
      actor.organization_id,
      {
        includeInternalFields: actor.role === UserRole.ADMIN,
      },
    );
    if (doc.type !== 'invoice') {
      throw new NotFoundException('Invoice not found');
    }
    return doc;
  }

  async update(id: string, payload: UpdateDocumentDto, actor: AuthActor) {
    await this.findById(id, actor);
    return this.documentsService.update(
      id,
      payload,
      actor.organization_id,
      actor.user_id,
      { includeInternalFields: actor.role === UserRole.ADMIN },
    );
  }

  async updateLinePurchaseStatuses(
    id: string,
    version: number,
    updates: Array<{ line_id: string; purchase_status: PurchaseStatus }>,
    actor: AuthActor,
  ) {
    await this.findById(id, actor);
    return this.documentsService.updateLinePurchaseStatuses(
      id,
      version,
      updates,
      actor.organization_id,
      actor.user_id,
    );
  }

  async transitionStatus(
    id: string,
    payload: TransitionDocumentStatusDto,
    actor: AuthActor,
  ) {
    await this.findById(id, actor);
    return this.documentsService.transitionStatus(
      id,
      payload,
      actor.organization_id,
      actor.user_id,
    );
  }

  async restore(id: string, payload: RestoreDocumentDto, actor: AuthActor) {
    await this.findById(id, actor);
    return this.documentsService.restoreArchived(
      id,
      payload,
      actor.organization_id,
      actor.user_id,
    );
  }
}
