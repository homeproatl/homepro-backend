import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import {
  calculateDocumentLine,
  calculateDocumentTotals,
  roundHalfAwayFromZero,
} from '../common/calculators/document-calculators';
import { Address } from '../common/schemas/address.schema';
import { asObjectId } from '../common/utils/object-id';
import { withOrganizationScope } from '../common/utils/organization-scope';
import {
  parseCalendarDateUtc,
  startOfBusinessCalendarDateUtc,
} from '../common/utils/business-time';
import { Client, ClientDocument } from '../clients/schemas/client.schema';
import { Item, ItemDocument } from '../items/schemas/item.schema';
import {
  Organization,
  OrganizationDocument,
} from '../organizations/schemas/organization.schema';
import {
  AppSettings,
  AppSettingsDocument,
  buildDefaultPaymentTerms,
} from '../settings/schemas/app-settings.schema';
import { SettingsService } from '../settings/settings.service';
import { ContractTemplatesService } from './contract-templates.service';
import { buildDocumentFrozenHash } from './document-hash';
import { DocumentNumbersService } from './document-numbers.service';
import {
  assertTransition,
  isFreezeTransition,
  isStatusAllowedForType,
  isUnfreezeTransition,
  type DocumentType,
} from './document-status';
import {
  CreateDocumentDto,
  DocumentLineItemWriteDto,
} from './dto/create-document.dto';
import { ListDocumentsQueryDto } from './dto/list-documents-query.dto';
import { ListEstimateDocumentsQueryDto } from './dto/list-estimate-documents-query.dto';
import { RestoreDocumentDto } from './dto/transition-document-status.dto';
import { TransitionDocumentStatusDto } from './dto/transition-document-status.dto';
import { UpdateDocumentDto } from './dto/update-document.dto';
import {
  DocumentEvent,
  DocumentEventDocument,
} from './schemas/document-event.schema';
import {
  ClientDocumentSnapshot,
  CompanyDocumentSnapshot,
  DOCUMENT_FIELD_LIMITS,
  DocumentLineItem,
  OrgDocument,
  OrgDocumentDocument,
  PurchaseStatus,
  SettingsDocumentSnapshot,
} from './schemas/document.schema';
import { TaxRatesService } from './tax-rates.service';

type BuiltLine = DocumentLineItem & { _id?: Types.ObjectId };

export type DocumentWriteOptions = {
  /** When false, private notes and line internal fields are merged from existing. */
  includeInternalFields?: boolean;
};

@Injectable()
export class DocumentsService {
  constructor(
    @InjectModel(OrgDocument.name)
    private readonly documentModel: Model<OrgDocumentDocument>,
    @InjectModel(DocumentEvent.name)
    private readonly documentEventModel: Model<DocumentEventDocument>,
    @InjectModel(Client.name)
    private readonly clientModel: Model<ClientDocument>,
    @InjectModel(Item.name)
    private readonly itemModel: Model<ItemDocument>,
    @InjectModel(Organization.name)
    private readonly organizationModel: Model<OrganizationDocument>,
    @InjectModel(AppSettings.name)
    private readonly appSettingsModel: Model<AppSettingsDocument>,
    private readonly documentNumbersService: DocumentNumbersService,
    private readonly taxRatesService: TaxRatesService,
    private readonly contractTemplatesService: ContractTemplatesService,
    private readonly settingsService: SettingsService,
  ) {}

  async create(
    payload: CreateDocumentDto,
    organizationId: string,
    actorUserId: string,
  ) {
    const client = await this.requireActiveClient(
      payload.client_id,
      organizationId,
    );
    const snapshotSource =
      await this.settingsService.getSnapshotSource(organizationId);
    const snapshots = await this.buildSnapshots(
      client,
      organizationId,
      snapshotSource,
    );
    const docDefaults = snapshotSource.documents;
    const builtLines = await this.buildCalculatedLines(
      payload.line_items,
      organizationId,
    );

    const depositRequested =
      payload.deposit_requested_minor !== undefined
        ? payload.deposit_requested_minor
        : this.defaultDepositMinor(
            calculateDocumentTotals({
              lines: builtLines,
              deposit_requested_minor: 0,
            }).total_minor,
            docDefaults.default_deposit_basis_points ?? 0,
          );

    const totals = this.calculateTotalsOrThrow({
      lines: builtLines,
      deposit_requested_minor: depositRequested,
    });

    const serviceAddress = this.resolveServiceAddressSnapshot(
      payload.service_address_snapshot,
      snapshots.client_snapshot.service_address,
    );

    let contractTemplateId: Types.ObjectId | null = null;
    let contractSnapshot: string | null = null;
    if (payload.contract_template_id) {
      const template =
        await this.contractTemplatesService.findActiveDocumentById(
          payload.contract_template_id,
          organizationId,
        );
      contractTemplateId = template._id;
      contractSnapshot = template.body;
    } else {
      // Apply org default contract template when create omits one.
      try {
        const defaultTpl =
          await this.contractTemplatesService.ensureDefaultContractTemplate(
            organizationId,
          );
        const template =
          await this.contractTemplatesService.findActiveDocumentById(
            defaultTpl.id,
            organizationId,
          );
        contractTemplateId = template._id;
        contractSnapshot = template.body;
      } catch {
        // No usable default template — leave null.
      }
    }

    const number = await this.documentNumbersService.allocateNextNumber(
      organizationId,
      payload.type,
    );

    const issueDate =
      this.parseOptionalDate(payload.issue_date) ??
      startOfBusinessCalendarDateUtc(
        new Date(),
        snapshotSource.business_timezone,
      );
    const expirationDate =
      payload.expiration_date !== undefined
        ? this.parseOptionalDate(payload.expiration_date)
        : payload.type === 'estimate'
          ? this.addUtcDays(
              issueDate,
              docDefaults.default_estimate_expiration_days ?? 30,
            )
          : null;
    const dueDate =
      payload.due_date !== undefined
        ? this.parseOptionalDate(payload.due_date)
        : payload.type === 'invoice'
          ? this.addUtcDays(
              issueDate,
              docDefaults.default_invoice_due_days ?? 30,
            )
          : null;
    this.assertDocumentDates(payload.type, issueDate, expirationDate, dueDate);

    const created = await this.documentModel.create({
      organization_id: asObjectId(organizationId, 'organization id'),
      type: payload.type,
      number,
      po_number: payload.po_number ?? null,
      client_id: client._id,
      project_id: null,
      job_name: payload.job_name ?? null,
      service_address_snapshot: serviceAddress,
      issue_date: issueDate,
      expiration_date: expirationDate,
      due_date: dueDate,
      status: 'draft',
      archived_from_status: null,
      source_estimate_id: null,
      client_snapshot: snapshots.client_snapshot,
      company_snapshot: snapshots.company_snapshot,
      settings_snapshot: snapshots.settings_snapshot,
      line_items: builtLines,
      ...totals,
      email_state: 'not_sent',
      sync_state: 'not_synced',
      online_payments_enabled:
        payload.type === 'invoice'
          ? (payload.online_payments_enabled ?? true)
          : false,
      auto_generate_invoice_enabled: false,
      contract_template_id: contractTemplateId,
      contract_snapshot: contractSnapshot,
      show_client_signature:
        payload.show_client_signature !== undefined
          ? payload.show_client_signature
          : docDefaults.default_show_client_signature === true,
      show_company_signature:
        payload.show_company_signature !== undefined
          ? payload.show_company_signature
          : false,
      customer_notes:
        payload.customer_notes !== undefined ? payload.customer_notes : null,
      private_notes: payload.private_notes ?? null,
      document_photo_asset_ids: this.toObjectIds(
        payload.document_photo_asset_ids,
        'document photo asset id',
      ),
      attachment_asset_ids: this.toObjectIds(
        payload.attachment_asset_ids,
        'attachment asset id',
      ),
      version: 1,
      frozen_revision_number: null,
      frozen_hash: null,
    });

    await this.appendEvent({
      organizationId,
      documentId: created._id,
      actorUserId,
      action: 'create',
      oldStatus: null,
      newStatus: 'draft',
      metadata: { type: payload.type, number },
    });

    return this.serialize(created);
  }

  async findPage(query: ListDocumentsQueryDto, organizationId: string) {
    const filter = this.buildListFilter(query, organizationId);
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
      items: docs.map((doc) => this.serialize(doc)),
      total,
      page,
      page_size: pageSize,
      page_count: pageCount,
    };
  }

  /**
   * Paginated estimate summaries for Step 8 list UI.
   * Never returns line items, private notes, or internal material fields.
   */
  async findEstimateSummariesPage(
    query: ListEstimateDocumentsQueryDto,
    organizationId: string,
  ) {
    const filter = this.buildEstimateListFilter(query, organizationId);
    const requestedPage = query.page ?? 1;
    const pageSize = Math.min(
      query.page_size ?? 25,
      DOCUMENT_FIELD_LIMITS.page_size_max,
    );

    const total = await this.documentModel.countDocuments(filter).exec();
    const pageCount = total === 0 ? 1 : Math.ceil(total / pageSize);
    const page = Math.min(Math.max(requestedPage, 1), pageCount);
    const skip = (page - 1) * pageSize;

    const sortField = query.sort ?? 'issue_date';
    const sortDirection = query.direction === 'asc' ? 1 : -1;
    const sort: Record<string, 1 | -1> = {
      [sortField]: sortDirection,
      _id: sortDirection,
    };

    const docs = await this.documentModel
      .find(filter)
      .sort(sort)
      .skip(skip)
      .limit(pageSize)
      .exec();

    return {
      items: docs.map((doc) => this.serializeEstimateSummary(doc)),
      total,
      page,
      page_size: pageSize,
      page_count: pageCount,
    };
  }

  async findAll(
    query: ListDocumentsQueryDto,
    organizationId: string,
    options: { includeInternalFields?: boolean } = {},
  ) {
    const docs = await this.documentModel
      .find(this.buildListFilter(query, organizationId))
      .sort({ updated_at: -1, _id: -1 })
      .exec();
    return docs.map((doc) =>
      this.serializeDocument(doc, {
        includeInternalFields: options.includeInternalFields !== false,
      }),
    );
  }

  async findById(
    id: string,
    organizationId: string,
    options: { includeInternalFields?: boolean } = {},
  ) {
    const doc = await this.findDocumentById(id, organizationId);
    return this.serializeDocument(doc, {
      includeInternalFields: options.includeInternalFields !== false,
    });
  }

  async findDocumentEntity(id: string, organizationId: string) {
    return this.findDocumentById(id, organizationId);
  }

  async update(
    id: string,
    payload: UpdateDocumentDto,
    organizationId: string,
    actorUserId: string,
    writeOptions: DocumentWriteOptions = {},
  ) {
    const includeInternalFields = writeOptions.includeInternalFields !== false;
    const existing = await this.findDocumentById(id, organizationId);
    this.assertVersion(existing, payload.version);
    this.assertNotImportedSummary(existing);

    if (existing.status === 'archived') {
      throw new ConflictException({
        code: 'DOCUMENT_ARCHIVED',
        message:
          'Archived documents cannot be edited. Restore the document first.',
      });
    }

    const writeLocked =
      existing.status === 'void' || existing.frozen_hash != null;
    if (writeLocked && this.hasLockedFieldEdit(payload)) {
      throw new ConflictException({
        code: existing.status === 'void' ? 'DOCUMENT_VOID' : 'DOCUMENT_FROZEN',
        message:
          existing.status === 'void'
            ? 'Void documents are financially terminal and cannot be edited.'
            : 'Financial or customer fields cannot be edited while this revision is frozen. Return an estimate to draft, or create a new invoice document.',
        frozen_revision_number: existing.frozen_revision_number,
      });
    }

    if (payload.refresh_snapshots === true && existing.status !== 'draft') {
      throw new BadRequestException(
        'Snapshots can only be refreshed while the document is in draft.',
      );
    }

    let client: ClientDocument;
    const clientIdChanged =
      payload.client_id !== undefined &&
      payload.client_id !== String(existing.client_id);
    if (payload.client_id) {
      client = await this.requireActiveClient(
        payload.client_id,
        organizationId,
      );
    } else {
      client = await this.requireClient(
        String(existing.client_id),
        organizationId,
      );
      if (client.is_archived === true && payload.refresh_snapshots === true) {
        throw new BadRequestException(
          'Cannot refresh snapshots from an archived client.',
        );
      }
    }

    const lineSource = payload.line_items
      ? await this.buildCalculatedLines(payload.line_items, organizationId, {
          existingLines: existing.line_items ?? [],
          preserveInternalFromExisting: !includeInternalFields,
        })
      : (existing.line_items as BuiltLine[]);

    const deposit =
      payload.deposit_requested_minor !== undefined
        ? payload.deposit_requested_minor
        : existing.deposit_requested_minor;

    const totals = this.calculateTotalsOrThrow({
      lines: lineSource,
      deposit_requested_minor: deposit,
      amount_paid_minor: existing.amount_paid_minor,
      amount_refunded_minor: existing.amount_refunded_minor,
      amount_disputed_minor: existing.amount_disputed_minor,
    });

    const nextIssueDate =
      payload.issue_date !== undefined
        ? this.parseOptionalDate(payload.issue_date)
        : existing.issue_date;
    const nextExpirationDate =
      payload.expiration_date !== undefined
        ? this.parseOptionalDate(payload.expiration_date)
        : existing.expiration_date;
    const nextDueDate =
      payload.due_date !== undefined
        ? this.parseOptionalDate(payload.due_date)
        : existing.due_date;
    this.assertDocumentDates(
      existing.type,
      nextIssueDate,
      nextExpirationDate,
      nextDueDate,
    );

    let contractTemplateId = existing.contract_template_id;
    let contractSnapshot = existing.contract_snapshot;
    if (payload.contract_template_id !== undefined) {
      if (payload.contract_template_id === null) {
        contractTemplateId = null;
        contractSnapshot = null;
      } else {
        const template =
          await this.contractTemplatesService.findActiveDocumentById(
            payload.contract_template_id,
            organizationId,
          );
        contractTemplateId = template._id;
        contractSnapshot = template.body;
      }
    }

    let clientSnapshot = existing.client_snapshot;
    let companySnapshot = existing.company_snapshot;
    let settingsSnapshot = existing.settings_snapshot;
    let serviceAddress = existing.service_address_snapshot;

    if (payload.refresh_snapshots === true || clientIdChanged) {
      const snapshots = await this.buildSnapshots(client, organizationId);
      clientSnapshot = snapshots.client_snapshot;
      companySnapshot = snapshots.company_snapshot;
      settingsSnapshot = snapshots.settings_snapshot;
      if (payload.service_address_snapshot === undefined) {
        serviceAddress = snapshots.client_snapshot.service_address ?? null;
      }
    }

    if (payload.service_address_snapshot !== undefined) {
      serviceAddress = this.resolveServiceAddressSnapshot(
        payload.service_address_snapshot,
        serviceAddress,
      );
    }

    const updated = await this.documentModel
      .findOneAndUpdate(
        withOrganizationScope(organizationId, {
          _id: existing._id,
          version: payload.version,
        }),
        {
          $set: {
            client_id: client._id,
            po_number:
              payload.po_number !== undefined
                ? payload.po_number
                : existing.po_number,
            job_name:
              payload.job_name !== undefined
                ? payload.job_name
                : existing.job_name,
            issue_date: nextIssueDate,
            expiration_date: nextExpirationDate,
            due_date: nextDueDate,
            line_items: lineSource,
            // Content updates must not clobber payment ledger fields.
            subtotal_minor: totals.subtotal_minor,
            markup_total_minor: totals.markup_total_minor,
            discount_total_minor: totals.discount_total_minor,
            tax_total_minor: totals.tax_total_minor,
            deposit_requested_minor: totals.deposit_requested_minor,
            total_minor: totals.total_minor,
            balance_due_minor: totals.balance_due_minor,
            contract_template_id: contractTemplateId,
            contract_snapshot: contractSnapshot,
            show_client_signature:
              payload.show_client_signature !== undefined
                ? payload.show_client_signature
                : existing.show_client_signature,
            show_company_signature:
              payload.show_company_signature !== undefined
                ? payload.show_company_signature
                : existing.show_company_signature,
            online_payments_enabled:
              existing.type === 'invoice' &&
              payload.online_payments_enabled !== undefined
                ? payload.online_payments_enabled
                : existing.online_payments_enabled,
            auto_generate_invoice_enabled:
              existing.auto_generate_invoice_enabled,
            customer_notes:
              payload.customer_notes !== undefined
                ? payload.customer_notes
                : existing.customer_notes,
            private_notes: includeInternalFields
              ? payload.private_notes !== undefined
                ? payload.private_notes
                : existing.private_notes
              : existing.private_notes,
            client_snapshot: clientSnapshot,
            company_snapshot: companySnapshot,
            settings_snapshot: settingsSnapshot,
            service_address_snapshot: serviceAddress,
            document_photo_asset_ids:
              payload.document_photo_asset_ids !== undefined
                ? this.toObjectIds(
                    payload.document_photo_asset_ids,
                    'document photo asset id',
                  )
                : existing.document_photo_asset_ids,
            attachment_asset_ids:
              payload.attachment_asset_ids !== undefined
                ? this.toObjectIds(
                    payload.attachment_asset_ids,
                    'attachment asset id',
                  )
                : existing.attachment_asset_ids,
          },
          $inc: { version: 1 },
        },
        { returnDocument: 'after' },
      )
      .exec();

    if (!updated) {
      await this.throwStaleOrMissing(id, organizationId);
    }

    await this.appendEvent({
      organizationId,
      documentId: updated!._id,
      actorUserId,
      action: 'update',
      oldStatus: existing.status,
      newStatus: updated!.status,
      metadata: { version: updated!.version },
    });

    return this.serializeDocument(updated!, { includeInternalFields });
  }

  async transitionStatus(
    id: string,
    payload: TransitionDocumentStatusDto,
    organizationId: string,
    actorUserId: string,
  ) {
    const existing = await this.findDocumentById(id, organizationId);
    this.assertVersion(existing, payload.version);
    this.assertNotImportedSummary(existing);

    if (!isStatusAllowedForType(existing.type, payload.status)) {
      throw new ConflictException({
        code: 'INVALID_STATUS_FOR_TYPE',
        message: `Status '${payload.status}' is not allowed for ${existing.type} documents.`,
      });
    }

    assertTransition(existing.type, existing.status, payload.status);

    const $set: Record<string, unknown> = {
      status: payload.status,
    };

    if (payload.status === 'archived' && existing.status !== 'archived') {
      $set.archived_from_status = existing.status;
    }

    const shouldFreeze =
      isFreezeTransition(existing.type, existing.status, payload.status) ||
      (payload.status === 'void' && existing.frozen_hash == null);

    if (shouldFreeze) {
      const revision = (existing.frozen_revision_number ?? 0) + 1;
      $set.frozen_revision_number = revision;
      $set.frozen_hash = buildDocumentFrozenHash(
        this.toPlainFrozenSource(existing),
      );
    }

    if (isUnfreezeTransition(existing.type, existing.status, payload.status)) {
      $set.frozen_hash = null;
    }

    const updated = await this.documentModel
      .findOneAndUpdate(
        withOrganizationScope(organizationId, {
          _id: existing._id,
          version: payload.version,
        }),
        {
          $set,
          $inc: { version: 1 },
        },
        { returnDocument: 'after' },
      )
      .exec();

    if (!updated) {
      await this.throwStaleOrMissing(id, organizationId);
    }

    await this.appendEvent({
      organizationId,
      documentId: updated!._id,
      actorUserId,
      action: 'status.changed',
      oldStatus: existing.status,
      newStatus: payload.status,
      metadata: { version: updated!.version },
    });

    return this.serialize(updated!);
  }

  /**
   * Admin materials workflow: update purchase_status only without recalculating
   * customer-facing totals or touching frozen financial fields.
   */
  async updateLinePurchaseStatuses(
    id: string,
    version: number,
    updates: Array<{ line_id: string; purchase_status: PurchaseStatus }>,
    organizationId: string,
    actorUserId: string,
  ) {
    const existing = await this.findDocumentById(id, organizationId);
    this.assertVersion(existing, version);
    this.assertNotImportedSummary(existing);

    if (existing.status === 'archived') {
      throw new ConflictException({
        code: 'DOCUMENT_ARCHIVED',
        message:
          'Archived documents cannot be edited. Restore the document first.',
      });
    }

    if (existing.type === 'estimate') {
      const invoice = await this.documentModel
        .findOne(
          withOrganizationScope(organizationId, {
            type: 'invoice' as const,
            source_estimate_id: existing._id,
          }),
        )
        .select({ _id: 1, number: 1 })
        .exec();
      if (invoice) {
        throw new ConflictException({
          code: 'PURCHASE_STATUS_OWNED_BY_INVOICE',
          message:
            'Purchase status is owned by the converted invoice. Update materials on the invoice.',
          invoice_id: String(invoice._id),
          invoice_number: invoice.number ?? null,
        });
      }
    }

    const updatesByLineId = new Map(
      updates.map((entry) => [entry.line_id, entry.purchase_status]),
    );

    const lineItems = (existing.line_items ?? []).map((line) => {
      const lineId = line._id ? String(line._id) : '';
      const nextStatus = updatesByLineId.get(lineId);
      const withToObject = line as unknown as {
        toObject?: () => Record<string, unknown>;
      };
      const plain =
        typeof withToObject.toObject === 'function'
          ? withToObject.toObject()
          : { ...(line as unknown as Record<string, unknown>) };
      if (nextStatus === undefined) {
        return plain;
      }
      return {
        ...plain,
        purchase_status: nextStatus,
      };
    });

    const unknownLineIds = updates
      .map((entry) => entry.line_id)
      .filter(
        (lineId) =>
          !lineItems.some((line) => {
            const id = line._id;
            return id instanceof Types.ObjectId && id.toHexString() === lineId;
          }),
      );
    if (unknownLineIds.length > 0) {
      throw new BadRequestException(
        `Unknown line id(s): ${unknownLineIds.join(', ')}`,
      );
    }

    const updated = await this.documentModel
      .findOneAndUpdate(
        withOrganizationScope(organizationId, {
          _id: existing._id,
          version,
        }),
        {
          $set: { line_items: lineItems },
          $inc: { version: 1 },
        },
        { returnDocument: 'after' },
      )
      .exec();

    if (!updated) {
      await this.throwStaleOrMissing(id, organizationId);
    }

    await this.appendEvent({
      organizationId,
      documentId: updated!._id,
      actorUserId,
      action: 'purchase_status_update',
      oldStatus: existing.status,
      newStatus: existing.status,
      metadata: {
        line_count: updates.length,
        version: updated!.version,
      },
    });

    return this.serialize(updated!);
  }

  async restoreArchived(
    id: string,
    payload: RestoreDocumentDto,
    organizationId: string,
    actorUserId: string,
  ) {
    const existing = await this.findDocumentById(id, organizationId);
    this.assertVersion(existing, payload.version);
    this.assertNotImportedSummary(existing);

    if (existing.status !== 'archived') {
      throw new ConflictException({
        code: 'NOT_ARCHIVED',
        message: 'Only archived documents can be restored.',
      });
    }

    const restoreTo = existing.archived_from_status;
    if (!restoreTo) {
      throw new ConflictException({
        code: 'MISSING_ARCHIVED_FROM_STATUS',
        message: 'Archived document is missing archived_from_status.',
      });
    }

    if (!isStatusAllowedForType(existing.type, restoreTo)) {
      throw new ConflictException({
        code: 'INVALID_RESTORE_STATUS',
        message: `Cannot restore to status '${restoreTo}' for ${existing.type}.`,
      });
    }

    const updated = await this.documentModel
      .findOneAndUpdate(
        withOrganizationScope(organizationId, {
          _id: existing._id,
          version: payload.version,
          status: 'archived',
        }),
        {
          $set: {
            status: restoreTo,
            archived_from_status: null,
          },
          $inc: { version: 1 },
        },
        { returnDocument: 'after' },
      )
      .exec();

    if (!updated) {
      await this.throwStaleOrMissing(id, organizationId);
    }

    await this.appendEvent({
      organizationId,
      documentId: updated!._id,
      actorUserId,
      action: 'restore',
      oldStatus: 'archived',
      newStatus: restoreTo,
      metadata: { version: updated!.version },
    });

    return this.serialize(updated!);
  }

  async remove(id: string, organizationId: string, actorUserId: string) {
    const existing = await this.findDocumentById(id, organizationId);
    this.assertNotImportedSummary(existing);
    if (existing.status !== 'draft') {
      throw new ConflictException({
        code: 'DOCUMENT_DELETE_BLOCKED',
        message:
          'Only draft documents can be deleted. Archive or void sent customer documents to preserve history.',
      });
    }

    await this.documentModel
      .deleteOne(
        withOrganizationScope(organizationId, {
          _id: existing._id,
        }),
      )
      .exec();

    await this.appendEvent({
      organizationId,
      documentId: existing._id,
      actorUserId,
      action: 'delete',
      oldStatus: existing.status,
      newStatus: null,
      metadata: { hard_delete: true },
    });

    return { deleted: true };
  }

  private async buildCalculatedLines(
    lines: DocumentLineItemWriteDto[],
    organizationId: string,
    options: {
      existingLines?: DocumentLineItem[];
      preserveInternalFromExisting?: boolean;
    } = {},
  ): Promise<BuiltLine[]> {
    const built: BuiltLine[] = [];
    const existingById = new Map(
      (options.existingLines ?? [])
        .filter((line) => line._id)
        .map((line) => [String(line._id), line]),
    );

    for (const line of lines) {
      if (line.item_id) {
        await this.requireActiveItem(line.item_id, organizationId);
      }

      const existingLine =
        line.id && existingById.has(line.id)
          ? existingById.get(line.id)
          : undefined;
      if (line.id && !existingLine) {
        throw new BadRequestException(`Unknown line id: ${line.id}`);
      }

      const taxRequested = line.taxable === true;
      const explicitTaxIds = taxRequested
        ? [
            ...new Set(
              line.tax_ids && line.tax_ids.length > 0
                ? line.tax_ids
                : line.tax_id
                  ? [line.tax_id]
                  : [],
            ),
          ]
        : [];
      let taxRateBps = 0;
      let taxObjectId: Types.ObjectId | null = null;
      let taxObjectIds: Types.ObjectId[] = [];
      let taxNameSnapshot: string | null = null;
      if (explicitTaxIds.length > 0) {
        const existingTaxIds = existingLine
          ? (existingLine.tax_ids?.length
              ? existingLine.tax_ids
              : existingLine.tax_id
                ? [existingLine.tax_id]
                : []
            ).map(String)
          : [];
        const sameTaxSelection =
          existingLine?.taxable === true &&
          existingTaxIds.length === explicitTaxIds.length &&
          explicitTaxIds.every((taxId) => existingTaxIds.includes(taxId));

        if (
          sameTaxSelection &&
          (existingLine?.tax_rate_basis_points ?? 0) > 0
        ) {
          taxRateBps = existingLine.tax_rate_basis_points;
          taxObjectIds = existingTaxIds.map((taxId) =>
            asObjectId(taxId, 'tax rate id'),
          );
          taxObjectId = taxObjectIds[0] ?? null;
          taxNameSnapshot = existingLine?.tax_name_snapshot ?? null;
        } else {
          const taxes = await this.taxRatesService.findActiveDocumentsByIds(
            explicitTaxIds,
            organizationId,
          );
          taxRateBps = taxes.reduce(
            (sum, tax) => sum + tax.rate_basis_points,
            0,
          );
          taxObjectIds = taxes.map((tax) => tax._id);
          taxObjectId = taxObjectIds[0] ?? null;
          taxNameSnapshot = taxes
            .map(
              (tax) =>
                `${tax.name} (${(tax.rate_basis_points / 100).toFixed(3)}%)`,
            )
            .join(', ');
        }
      }

      const markupType = line.markup_type ?? 'none';
      const markupValue = line.markup_value ?? 0;
      const discountType = line.discount_type ?? 'none';
      const discountValue = line.discount_value ?? 0;

      if (markupType === 'none' && markupValue !== 0) {
        throw new BadRequestException(
          'markup_value must be 0 when markup_type is none',
        );
      }
      if (discountType === 'none' && discountValue !== 0) {
        throw new BadRequestException(
          'discount_value must be 0 when discount_type is none',
        );
      }

      const preserveInternal = options.preserveInternalFromExisting === true;
      const vendorName = preserveInternal
        ? (existingLine?.vendor_name ?? null)
        : (line.vendor_name ?? null);
      const internalUnitCost = preserveInternal
        ? (existingLine?.internal_unit_cost_minor ?? null)
        : (line.internal_unit_cost_minor ?? null);
      const wasteBasisPoints = preserveInternal
        ? (existingLine?.waste_basis_points ?? 0)
        : (line.waste_basis_points ?? 0);
      const purchaseStatus = preserveInternal
        ? (existingLine?.purchase_status ??
          line.purchase_status ??
          'not_needed')
        : (line.purchase_status ?? 'not_needed');

      const applyTax = taxRequested && taxRateBps > 0;
      let calculated: ReturnType<typeof calculateDocumentLine>;
      try {
        calculated = calculateDocumentLine({
          rate_minor: line.rate_minor,
          quantity_milli: line.quantity_milli,
          markup_type: markupType,
          markup_value: markupValue,
          discount_type: discountType,
          discount_value: discountValue,
          taxable: applyTax,
          tax_rate_basis_points: applyTax ? taxRateBps : 0,
          internal_unit_cost_minor: internalUnitCost,
          waste_basis_points: wasteBasisPoints,
        });
      } catch (error) {
        throw new BadRequestException(
          error instanceof Error ? error.message : 'Invalid line item values',
        );
      }

      built.push({
        ...(existingLine?._id ? { _id: existingLine._id } : {}),
        item_id: line.item_id ? asObjectId(line.item_id, 'item id') : null,
        sort_order: line.sort_order,
        line_type: line.line_type,
        description: line.description,
        notes: line.notes ?? null,
        unit_of_measure: line.unit_of_measure ?? null,
        sku_or_part_number: line.sku_or_part_number ?? null,
        vendor_name: vendorName,
        purchase_status: purchaseStatus,
        internal_unit_cost_minor: internalUnitCost,
        waste_basis_points: wasteBasisPoints,
        rate_minor: line.rate_minor,
        quantity_milli: line.quantity_milli,
        adjusted_quantity_milli: calculated.adjusted_quantity_milli,
        internal_cost_total_minor: calculated.internal_cost_total_minor,
        markup_type: markupType,
        markup_value: markupValue,
        markup_amount_minor: calculated.markup_amount_minor,
        discount_type: discountType,
        discount_value: discountValue,
        discount_amount_minor: calculated.discount_amount_minor,
        taxable: applyTax,
        tax_id: taxObjectId,
        tax_ids: taxObjectIds,
        tax_name_snapshot: taxNameSnapshot,
        tax_rate_basis_points: applyTax ? taxRateBps : 0,
        tax_amount_minor: calculated.tax_amount_minor,
        subtotal_minor: calculated.subtotal_minor,
        total_minor: calculated.total_minor,
        photo_asset_ids:
          line.photo_asset_ids !== undefined
            ? this.toObjectIds(line.photo_asset_ids, 'line photo asset id')
            : (existingLine?.photo_asset_ids ?? []),
      });
    }

    return built;
  }

  private async buildSnapshots(
    client: ClientDocument,
    organizationId: string,
    snapshotSourceOverride?: Awaited<
      ReturnType<SettingsService['getSnapshotSource']>
    >,
  ): Promise<{
    client_snapshot: ClientDocumentSnapshot;
    company_snapshot: CompanyDocumentSnapshot;
    settings_snapshot: SettingsDocumentSnapshot;
  }> {
    const organization = await this.organizationModel
      .findById(asObjectId(organizationId, 'organization id'))
      .exec();
    if (!organization) {
      throw new NotFoundException('Organization not found');
    }

    const snapshotSource =
      snapshotSourceOverride ??
      (await this.settingsService.getSnapshotSource(organizationId));

    const serviceAddress =
      client.service_addresses?.[0] != null
        ? this.cloneAddress(client.service_addresses[0])
        : null;

    const client_snapshot: ClientDocumentSnapshot = {
      display_name: client.display_name,
      company_name: client.company_name ?? null,
      email: client.email ?? null,
      phone: client.phone ?? null,
      billing_address: this.cloneAddress(client.billing_address),
      service_address: serviceAddress,
    };

    const company = snapshotSource.company;
    const displayName =
      (typeof company.display_name === 'string' &&
      company.display_name.trim().length > 0
        ? company.display_name.trim()
        : null) ??
      (typeof company.legal_name === 'string' &&
      company.legal_name.trim().length > 0
        ? company.legal_name.trim()
        : null) ??
      organization.name;

    const company_snapshot: CompanyDocumentSnapshot = {
      display_name: displayName,
      legal_name: company.legal_name ?? null,
      phone: company.phone ?? null,
      email: company.email ?? null,
      website: company.website ?? null,
      address: this.cloneAddress(company.address),
      license_number: company.license_number ?? null,
      logo_asset_id:
        typeof company.logo_asset_id === 'string' &&
        Types.ObjectId.isValid(company.logo_asset_id)
          ? new Types.ObjectId(company.logo_asset_id)
          : null,
    };

    const documents = snapshotSource.documents;
    const settings_snapshot: SettingsDocumentSnapshot = {
      currency: (snapshotSource.preferences.currency ?? 'usd') as 'usd',
      locale: snapshotSource.preferences.locale ?? 'en-US',
      timezone: snapshotSource.business_timezone ?? 'America/New_York',
      payment_terms: buildDefaultPaymentTerms(
        documents.default_invoice_due_days ?? 30,
      ),
      footer: null,
    };

    return { client_snapshot, company_snapshot, settings_snapshot };
  }

  private cloneAddress(address: Address | null | undefined): Address | null {
    if (!address) {
      return null;
    }
    return {
      street: address.street ?? null,
      suite: address.suite ?? null,
      city: address.city ?? null,
      state: address.state ?? null,
      postal_code: address.postal_code ?? null,
      country: address.country ?? null,
    };
  }

  private async requireActiveClient(clientId: string, organizationId: string) {
    const client = await this.requireClient(clientId, organizationId);
    if (client.is_archived === true) {
      throw new BadRequestException('Client is archived or inactive');
    }
    return client;
  }

  private async requireClient(clientId: string, organizationId: string) {
    const client = await this.clientModel
      .findOne(
        withOrganizationScope(organizationId, {
          _id: asObjectId(clientId, 'client id'),
        }),
      )
      .exec();
    if (!client) {
      throw new NotFoundException('Client not found');
    }
    return client;
  }

  private async requireActiveItem(itemId: string, organizationId: string) {
    const item = await this.itemModel
      .findOne(
        withOrganizationScope(organizationId, {
          _id: asObjectId(itemId, 'item id'),
          is_active: true,
        }),
      )
      .exec();
    if (!item) {
      throw new BadRequestException('Item not found or inactive');
    }
    return item;
  }

  private findDocumentById(id: string, organizationId: string) {
    return this.documentModel
      .findOne(
        withOrganizationScope(organizationId, {
          _id: asObjectId(id, 'document id'),
        }),
      )
      .exec()
      .then((doc) => {
        if (!doc) {
          throw new NotFoundException('Document not found');
        }
        return doc;
      });
  }

  private assertVersion(doc: OrgDocumentDocument, version: number) {
    if (doc.version !== version) {
      throw new ConflictException({
        code: 'STALE_VERSION',
        message: 'Document was modified by another request.',
        current_version: doc.version,
        updated_at: doc.updated_at?.toISOString?.() ?? null,
      });
    }
  }

  /**
   * Fields that participate in the freeze hash / customer-facing snapshot.
   * Private notes remain editable while frozen or void.
   */
  private hasLockedFieldEdit(payload: UpdateDocumentDto): boolean {
    return (
      payload.line_items !== undefined ||
      payload.deposit_requested_minor !== undefined ||
      payload.client_id !== undefined ||
      payload.contract_template_id !== undefined ||
      payload.po_number !== undefined ||
      payload.job_name !== undefined ||
      payload.issue_date !== undefined ||
      payload.expiration_date !== undefined ||
      payload.due_date !== undefined ||
      payload.customer_notes !== undefined ||
      payload.show_client_signature !== undefined ||
      payload.show_company_signature !== undefined ||
      payload.refresh_snapshots === true ||
      payload.service_address_snapshot !== undefined
    );
  }

  private resolveServiceAddressSnapshot(
    payloadAddress: Partial<Address> | null | undefined,
    fallback: Address | null | undefined,
  ): Address | null {
    if (payloadAddress === undefined) {
      return fallback ? this.cloneAddress(fallback) : null;
    }
    if (payloadAddress === null) {
      return null;
    }
    return this.cloneAddress({
      street: payloadAddress.street ?? null,
      suite: payloadAddress.suite ?? null,
      city: payloadAddress.city ?? null,
      state: payloadAddress.state ?? null,
      postal_code: payloadAddress.postal_code ?? null,
      country: payloadAddress.country ?? null,
    });
  }

  private toPlainFrozenSource(doc: OrgDocumentDocument) {
    const withToObject = doc as OrgDocumentDocument & {
      toObject?: (options?: Record<string, unknown>) => Record<string, unknown>;
    };
    if (typeof withToObject.toObject === 'function') {
      return withToObject.toObject({ depopulate: true, flattenMaps: true });
    }
    return doc;
  }

  private async throwStaleOrMissing(
    id: string,
    organizationId: string,
  ): Promise<never> {
    const current = await this.documentModel
      .findOne(
        withOrganizationScope(organizationId, {
          _id: asObjectId(id, 'document id'),
        }),
      )
      .exec();
    if (!current) {
      throw new NotFoundException('Document not found');
    }
    throw new ConflictException({
      code: 'STALE_VERSION',
      message: 'Document was modified by another request.',
      current_version: current.version,
      updated_at: current.updated_at?.toISOString?.() ?? null,
    });
  }

  private buildListFilter(
    query: ListDocumentsQueryDto,
    organizationId: string,
  ) {
    const filter: Record<string, unknown> = withOrganizationScope(
      organizationId,
      {},
    );
    if (query.type) {
      filter.type = query.type;
    }
    if (query.status) {
      filter.status = query.status;
    }
    if (query.client_id) {
      filter.client_id = asObjectId(query.client_id, 'client id');
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

  private buildEstimateListFilter(
    query: ListEstimateDocumentsQueryDto,
    organizationId: string,
  ) {
    const filter: Record<string, unknown> = withOrganizationScope(
      organizationId,
      { type: 'estimate' },
    );

    if (query.status && query.status.length > 0) {
      filter.status =
        query.status.length === 1 ? query.status[0] : { $in: query.status };
    }

    if (query.client_id) {
      filter.client_id = asObjectId(query.client_id, 'client id');
    }

    if (query.email_state) {
      filter.email_state = query.email_state;
    }

    const issueDate: Record<string, Date> = {};
    const fromBound = query.date_from
      ? this.parseListDateBound(query.date_from, 'start')
      : null;
    const toBound = query.date_to
      ? this.parseListDateBound(query.date_to, 'end')
      : null;
    if (
      fromBound &&
      toBound &&
      (toBound.exclusive
        ? fromBound.date.getTime() >= toBound.date.getTime()
        : fromBound.date.getTime() > toBound.date.getTime())
    ) {
      throw new BadRequestException('date_from cannot be after date_to');
    }
    if (query.date_from) {
      issueDate.$gte = fromBound!.date;
    }
    if (query.date_to) {
      issueDate[toBound!.exclusive ? '$lt' : '$lte'] = toBound!.date;
    }
    if (Object.keys(issueDate).length > 0) {
      filter.issue_date = issueDate;
    }

    if (
      query.amount_min_minor !== undefined &&
      query.amount_max_minor !== undefined &&
      query.amount_min_minor > query.amount_max_minor
    ) {
      throw new BadRequestException(
        'amount_min_minor cannot be greater than amount_max_minor',
      );
    }

    const amount: Record<string, number> = {};
    if (query.amount_min_minor !== undefined) {
      amount.$gte = query.amount_min_minor;
    }
    if (query.amount_max_minor !== undefined) {
      amount.$lte = query.amount_max_minor;
    }
    if (Object.keys(amount).length > 0) {
      filter.total_minor = amount;
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

  private parseListDateBound(
    value: string,
    edge: 'start' | 'end',
  ): { date: Date; exclusive: boolean } {
    if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
      const start = parseCalendarDateUtc(value);
      if (!start) {
        throw new BadRequestException('Invalid date filter');
      }
      if (edge === 'start') return { date: start, exclusive: false };
      const endExclusive = new Date(start);
      endExclusive.setUTCDate(endExclusive.getUTCDate() + 1);
      return { date: endExclusive, exclusive: true };
    }
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
      throw new BadRequestException('Invalid date filter');
    }
    return { date, exclusive: false };
  }

  serializeEstimateSummary(doc: OrgDocumentDocument) {
    const address =
      doc.service_address_snapshot ??
      doc.client_snapshot?.service_address ??
      null;
    return {
      id: String(doc._id),
      number: doc.number,
      po_number: doc.po_number ?? null,
      client_id: String(doc.client_id),
      client_name:
        doc.client_snapshot?.display_name?.trim() ||
        doc.client_snapshot?.company_name?.trim() ||
        'Client',
      client_phone: doc.client_snapshot?.phone ?? null,
      job_name: doc.job_name ?? null,
      service_address_summary: this.formatAddressSummary(address),
      issue_date: doc.issue_date?.toISOString?.() ?? null,
      expiration_date: doc.expiration_date?.toISOString?.() ?? null,
      status: doc.status,
      email_state: doc.email_state,
      sync_state: doc.sync_state,
      total_minor: doc.total_minor,
      version: doc.version,
      created_at: doc.created_at?.toISOString?.() ?? null,
      updated_at: doc.updated_at?.toISOString?.() ?? null,
    };
  }

  serializeInvoiceSummary(doc: OrgDocumentDocument, paymentDisplay: string) {
    const address =
      doc.service_address_snapshot ??
      doc.client_snapshot?.service_address ??
      null;
    return {
      id: String(doc._id),
      number: doc.number,
      po_number: doc.po_number ?? null,
      client_id: String(doc.client_id),
      client_name:
        doc.client_snapshot?.display_name?.trim() ||
        doc.client_snapshot?.company_name?.trim() ||
        'Client',
      client_phone: doc.client_snapshot?.phone ?? null,
      job_name: doc.job_name ?? null,
      service_address_summary: this.formatAddressSummary(address),
      issue_date: doc.issue_date?.toISOString?.() ?? null,
      due_date: doc.due_date?.toISOString?.() ?? null,
      status: doc.status,
      email_state: doc.email_state,
      payment_display: paymentDisplay,
      total_minor: doc.total_minor,
      balance_due_minor: doc.balance_due_minor,
      amount_paid_minor: doc.amount_paid_minor,
      version: doc.version,
      source_estimate_id: doc.source_estimate_id
        ? String(doc.source_estimate_id)
        : null,
      created_at: doc.created_at?.toISOString?.() ?? null,
      updated_at: doc.updated_at?.toISOString?.() ?? null,
    };
  }

  private formatAddressSummary(address: Address | null | undefined) {
    if (!address) {
      return null;
    }
    const parts = [
      address.street,
      address.suite,
      [address.city, address.state].filter(Boolean).join(', ') || null,
      address.postal_code,
    ]
      .map((part) => (typeof part === 'string' ? part.trim() : ''))
      .filter((part) => part.length > 0);
    return parts.length > 0 ? parts.join(', ') : null;
  }

  private escapeRegex(value: string) {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  private parseOptionalDate(value?: string | null): Date | null {
    if (value === undefined || value === null || value === '') {
      return null;
    }
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
      throw new BadRequestException('Invalid date');
    }
    return date;
  }

  private assertDocumentDates(
    type: 'estimate' | 'invoice',
    issueDate: Date | null | undefined,
    expirationDate: Date | null | undefined,
    dueDate: Date | null | undefined,
  ) {
    if (!issueDate) return;
    if (
      type === 'estimate' &&
      expirationDate &&
      expirationDate.getTime() < issueDate.getTime()
    ) {
      throw new BadRequestException(
        'Estimate expiration date cannot be before the issue date.',
      );
    }
    if (
      type === 'invoice' &&
      dueDate &&
      dueDate.getTime() < issueDate.getTime()
    ) {
      throw new BadRequestException(
        'Invoice due date cannot be before the issue date.',
      );
    }
  }

  private calculateTotalsOrThrow(
    input: Parameters<typeof calculateDocumentTotals>[0],
  ) {
    try {
      return calculateDocumentTotals(input);
    } catch (error) {
      throw new BadRequestException(
        error instanceof Error ? error.message : 'Invalid document totals',
      );
    }
  }

  private addUtcDays(from: Date, days: number): Date {
    const result = new Date(from.getTime());
    result.setUTCDate(result.getUTCDate() + days);
    return result;
  }

  private defaultDepositMinor(
    totalMinor: number,
    depositBasisPoints: number,
  ): number {
    if (depositBasisPoints <= 0 || totalMinor <= 0) {
      return 0;
    }
    return Math.min(
      totalMinor,
      roundHalfAwayFromZero((totalMinor * depositBasisPoints) / 10_000),
    );
  }

  private async appendEvent(input: {
    organizationId: string;
    documentId: Types.ObjectId;
    actorUserId?: string | null;
    action: string;
    oldStatus: string | null;
    newStatus: string | null;
    metadata?: Record<string, unknown>;
  }) {
    await this.documentEventModel.create({
      organization_id: asObjectId(input.organizationId, 'organization id'),
      document_id: input.documentId,
      actor_user_id: input.actorUserId
        ? asObjectId(input.actorUserId, 'actor user id')
        : null,
      public_grant_id: null,
      action: input.action,
      old_status: input.oldStatus,
      new_status: input.newStatus,
      metadata: input.metadata ?? {},
      occurred_at: new Date(),
    });
  }

  serialize(doc: OrgDocumentDocument) {
    return this.serializeDocument(doc, { includeInternalFields: true });
  }

  serializeForEdit(
    doc: OrgDocumentDocument,
    options: { includeInternalFields: boolean },
  ) {
    return this.serializeDocument(doc, options);
  }

  private serializeDocument(
    doc: OrgDocumentDocument,
    options: { includeInternalFields: boolean },
  ) {
    return {
      id: String(doc._id),
      organization_id: String(doc.organization_id),
      type: doc.type,
      number: doc.number,
      po_number: doc.po_number ?? null,
      client_id: String(doc.client_id),
      project_id: doc.project_id ? String(doc.project_id) : null,
      job_name: doc.job_name ?? null,
      service_address_snapshot: doc.service_address_snapshot
        ? this.cloneAddress(doc.service_address_snapshot)
        : null,
      issue_date: doc.issue_date?.toISOString?.() ?? null,
      expiration_date: doc.expiration_date?.toISOString?.() ?? null,
      due_date: doc.due_date?.toISOString?.() ?? null,
      status: doc.status,
      archived_from_status: doc.archived_from_status ?? null,
      source_estimate_id: doc.source_estimate_id
        ? String(doc.source_estimate_id)
        : null,
      client_snapshot: doc.client_snapshot,
      company_snapshot: {
        ...doc.company_snapshot,
        logo_asset_id: doc.company_snapshot?.logo_asset_id
          ? String(doc.company_snapshot.logo_asset_id)
          : null,
      },
      settings_snapshot: doc.settings_snapshot,
      line_items: (doc.line_items ?? []).map((line) => ({
        id: line._id ? String(line._id) : undefined,
        item_id: line.item_id ? String(line.item_id) : null,
        sort_order: line.sort_order,
        line_type: line.line_type,
        description: line.description,
        notes: line.notes ?? null,
        unit_of_measure: line.unit_of_measure ?? null,
        sku_or_part_number: line.sku_or_part_number ?? null,
        vendor_name: options.includeInternalFields
          ? (line.vendor_name ?? null)
          : null,
        purchase_status: line.purchase_status,
        internal_unit_cost_minor: options.includeInternalFields
          ? (line.internal_unit_cost_minor ?? null)
          : null,
        waste_basis_points: options.includeInternalFields
          ? line.waste_basis_points
          : 0,
        rate_minor: line.rate_minor,
        quantity_milli: line.quantity_milli,
        adjusted_quantity_milli: options.includeInternalFields
          ? line.adjusted_quantity_milli
          : line.quantity_milli,
        internal_cost_total_minor: options.includeInternalFields
          ? line.internal_cost_total_minor
          : 0,
        markup_type: line.markup_type,
        markup_value: line.markup_value,
        markup_amount_minor: line.markup_amount_minor,
        discount_type: line.discount_type,
        discount_value: line.discount_value,
        discount_amount_minor: line.discount_amount_minor,
        taxable: line.taxable,
        tax_id: line.tax_id ? String(line.tax_id) : null,
        tax_ids: Array.isArray(line.tax_ids)
          ? line.tax_ids.map((taxId) => String(taxId))
          : line.tax_id
            ? [String(line.tax_id)]
            : [],
        tax_name_snapshot: line.tax_name_snapshot ?? null,
        source_line_id: line.source_line_id ?? null,
        tax_rate_basis_points: line.tax_rate_basis_points,
        tax_amount_minor: line.tax_amount_minor,
        subtotal_minor: line.subtotal_minor,
        total_minor: line.total_minor,
        photo_asset_ids: (line.photo_asset_ids ?? []).map(String),
      })),
      subtotal_minor: doc.subtotal_minor,
      markup_total_minor: doc.markup_total_minor,
      discount_total_minor: doc.discount_total_minor,
      document_discount_type: doc.document_discount_type,
      document_discount_value: doc.document_discount_value,
      tax_total_minor: doc.tax_total_minor,
      deposit_requested_minor: doc.deposit_requested_minor,
      total_minor: doc.total_minor,
      payment_schedule: (doc.payment_schedule ?? []).map((entry) => ({
        id: entry._id ? String(entry._id) : undefined,
        sort_order: entry.sort_order,
        label: entry.label,
        value_type: entry.value_type,
        value: entry.value,
        amount_minor: entry.amount_minor,
        due_date: entry.due_date?.toISOString?.() ?? null,
        status: entry.status ?? null,
      })),
      source_metadata: doc.source_metadata ?? null,
      migration_state: doc.migration_state ?? 'native',
      tax_breakdown_snapshot: (doc.tax_breakdown_snapshot ?? []).map((tax) => ({
        name: tax.name,
        amount_minor: tax.amount_minor,
        source_decimal: tax.source_decimal ?? null,
      })),
      source_subtotal_decimal: doc.source_subtotal_decimal ?? null,
      source_total_decimal: doc.source_total_decimal ?? null,
      source_payment_received_decimal:
        doc.source_payment_received_decimal ?? null,
      source_unexplained_adjustment_minor:
        doc.source_unexplained_adjustment_minor ?? 0,
      source_status: doc.source_status ?? null,
      source_account_id: doc.source_account_id ?? null,
      amount_paid_minor: doc.amount_paid_minor,
      amount_refunded_minor: doc.amount_refunded_minor,
      amount_disputed_minor: doc.amount_disputed_minor,
      balance_due_minor: doc.balance_due_minor,
      email_state: doc.email_state,
      sync_state: doc.sync_state,
      online_payments_enabled: doc.online_payments_enabled,
      auto_generate_invoice_enabled: doc.auto_generate_invoice_enabled,
      contract_template_id: doc.contract_template_id
        ? String(doc.contract_template_id)
        : null,
      contract_snapshot: doc.contract_snapshot ?? null,
      show_client_signature: doc.show_client_signature,
      show_company_signature: doc.show_company_signature,
      customer_notes: doc.customer_notes ?? null,
      private_notes: options.includeInternalFields
        ? (doc.private_notes ?? null)
        : null,
      document_photo_asset_ids: (doc.document_photo_asset_ids ?? []).map(
        String,
      ),
      attachment_asset_ids: (doc.attachment_asset_ids ?? []).map(String),
      document_photo_metadata: (doc.document_photo_metadata ?? []).map(
        (entry) => ({
          asset_id: String(entry.asset_id),
          caption: entry.caption ?? null,
          sort_order: entry.sort_order ?? 0,
        }),
      ),
      attachment_metadata: (doc.attachment_metadata ?? []).map((entry) => ({
        asset_id: String(entry.asset_id),
        filename: entry.filename ?? null,
        sort_order: entry.sort_order ?? 0,
      })),
      version: doc.version,
      frozen_revision_number: doc.frozen_revision_number ?? null,
      frozen_hash: doc.frozen_hash ?? null,
      created_at: doc.created_at?.toISOString?.() ?? null,
      updated_at: doc.updated_at?.toISOString?.() ?? null,
    };
  }

  private toObjectIds(values: string[] | undefined, field: string) {
    return (values ?? []).map((value) => asObjectId(value, field));
  }

  private assertNotImportedSummary(doc: OrgDocumentDocument) {
    if (doc.migration_state !== 'imported_summary') return;
    throw new ConflictException({
      code: 'IMPORTED_SUMMARY_READ_ONLY',
      message:
        'This Joist summary is read-only because the export did not include line items. Complete the detailed migration before changing it.',
    });
  }
}
