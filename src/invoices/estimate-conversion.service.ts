import {
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import { Connection, Model } from 'mongoose';
import { AuditLog } from '../audit-logs/schemas/audit-log.schema';
import { AssetsService } from '../assets/assets.service';
import type { AuthActor } from '../common/types/auth-actor';
import { startOfBusinessCalendarDateUtc } from '../common/utils/business-time';
import { asObjectId } from '../common/utils/object-id';
import { withOrganizationScope } from '../common/utils/organization-scope';
import { DocumentNumbersService } from '../documents/document-numbers.service';
import { DocumentsService } from '../documents/documents.service';
import {
  OrgDocument,
  OrgDocumentDocument,
} from '../documents/schemas/document.schema';
import { ConvertEstimateToInvoiceDto } from './dto/convert-estimate-to-invoice.dto';
import { SettingsService } from '../settings/settings.service';

@Injectable()
export class EstimateConversionService {
  private readonly logger = new Logger(EstimateConversionService.name);

  constructor(
    @InjectModel(OrgDocument.name)
    private readonly documentModel: Model<OrgDocumentDocument>,
    @InjectModel(AuditLog.name)
    private readonly auditLogModel: Model<AuditLog>,
    private readonly documentNumbersService: DocumentNumbersService,
    private readonly documentsService: DocumentsService,
    private readonly assetsService: AssetsService,
    private readonly settingsService: SettingsService,
    @InjectConnection()
    private readonly connection: Connection,
  ) {}

  async convertToInvoice(
    estimateId: string,
    dto: ConvertEstimateToInvoiceDto | undefined,
    actor: AuthActor,
  ) {
    const estObjectId = asObjectId(estimateId, 'estimate id');
    const orgObjectId = asObjectId(actor.organization_id, 'organization id');

    const existingInvoice = await this.documentModel
      .findOne({
        organization_id: orgObjectId,
        type: 'invoice',
        source_estimate_id: estObjectId,
      })
      .exec();

    if (existingInvoice) {
      this.logger.log(
        `Estimate ${estimateId} already converted to invoice ${existingInvoice.number}`,
      );
      // Repair a prior partial conversion and its independent media snapshot.
      await this.documentModel
        .updateOne(
          {
            _id: estObjectId,
            organization_id: orgObjectId,
            type: 'estimate',
            status: { $in: ['pending', 'invoiced'] },
          },
          {
            $set: { status: 'approved' },
            $inc: { version: 1 },
          },
        )
        .exec();
      const source = await this.documentModel
        .findOne({
          _id: estObjectId,
          organization_id: orgObjectId,
          type: 'estimate',
        })
        .exec();
      if (source) {
        await this.assetsService.cloneDocumentAssets(
          source,
          existingInvoice,
          actor.user_id,
        );
      }
      const repaired = await this.documentModel
        .findById(existingInvoice._id)
        .exec();
      return this.documentsService.serialize(repaired ?? existingInvoice);
    }

    const estimate = await this.documentModel
      .findOne(
        withOrganizationScope(actor.organization_id, {
          _id: estObjectId,
          type: 'estimate' as const,
        }),
      )
      .exec();

    if (!estimate) {
      throw new NotFoundException('Estimate not found');
    }

    if (estimate.status !== 'pending' && estimate.status !== 'approved') {
      throw new ConflictException({
        code: 'ESTIMATE_NOT_CONVERTIBLE',
        message: `Cannot convert estimate in status '${estimate.status}'. Only pending or approved estimates can be converted.`,
      });
    }

    const settings = await this.settingsService.getSnapshotSource(
      actor.organization_id,
    );
    const session = await this.connection.startSession();
    let invoiceDoc: OrgDocumentDocument | null = null;

    try {
      await session.withTransaction(async () => {
        const concurrentInvoice = await this.documentModel
          .findOne(
            {
              organization_id: orgObjectId,
              type: 'invoice',
              source_estimate_id: estObjectId,
            },
            null,
            { session },
          )
          .exec();

        if (concurrentInvoice) {
          invoiceDoc = concurrentInvoice;
          return;
        }

        const currentEstimate = await this.documentModel
          .findOne(
            {
              _id: estObjectId,
              organization_id: orgObjectId,
              type: 'estimate',
            },
            null,
            { session },
          )
          .exec();
        if (!currentEstimate) {
          throw new NotFoundException('Estimate not found');
        }
        if (
          currentEstimate.status !== 'pending' &&
          currentEstimate.status !== 'approved'
        ) {
          throw new ConflictException({
            code: 'ESTIMATE_NOT_CONVERTIBLE',
            message: `Cannot convert estimate in status '${currentEstimate.status}'. Only pending or approved estimates can be converted.`,
          });
        }

        const invoiceNumber =
          await this.documentNumbersService.allocateNextNumber(
            actor.organization_id,
            'invoice',
            session,
          );

        const invoiceLineItems = (currentEstimate.line_items ?? []).map(
          (line) => {
            const withToObject = line as unknown as {
              toObject?: () => Record<string, unknown>;
            };
            const plain =
              typeof withToObject.toObject === 'function'
                ? withToObject.toObject()
                : { ...(line as unknown as Record<string, unknown>) };
            delete plain._id;
            plain.photo_asset_ids = [];
            return plain;
          },
        );

        const now = new Date();
        const issueDate = startOfBusinessCalendarDateUtc(
          now,
          settings.business_timezone,
        );
        let dueDate: Date | null = null;
        if (dto?.due_date) {
          dueDate = new Date(dto.due_date);
          if (Number.isNaN(dueDate.getTime())) {
            throw new ConflictException('Invalid due_date');
          }
        } else {
          const defaultDueDate = new Date(issueDate);
          defaultDueDate.setUTCDate(
            defaultDueDate.getUTCDate() +
              (settings.documents.default_invoice_due_days ?? 30),
          );
          dueDate = defaultDueDate;
        }
        if (dueDate.getTime() < issueDate.getTime()) {
          throw new ConflictException(
            'Invoice due date cannot be before the issue date.',
          );
        }

        try {
          const [createdInvoice] = await this.documentModel.create(
            [
              {
                organization_id: orgObjectId,
                type: 'invoice',
                number: invoiceNumber,
                po_number: currentEstimate.po_number,
                client_id: currentEstimate.client_id,
                project_id: currentEstimate.project_id,
                job_name: currentEstimate.job_name,
                service_address_snapshot:
                  currentEstimate.service_address_snapshot,
                issue_date: issueDate,
                due_date: dueDate,
                expiration_date: null,
                status: 'draft',
                archived_from_status: null,
                source_estimate_id: currentEstimate._id,
                client_snapshot: currentEstimate.client_snapshot,
                company_snapshot: currentEstimate.company_snapshot,
                settings_snapshot: {
                  ...currentEstimate.settings_snapshot,
                  payment_terms:
                    dto?.payment_terms ??
                    currentEstimate.settings_snapshot?.payment_terms ??
                    null,
                },
                line_items: invoiceLineItems,
                subtotal_minor: currentEstimate.subtotal_minor,
                markup_total_minor: currentEstimate.markup_total_minor,
                discount_total_minor: currentEstimate.discount_total_minor,
                tax_total_minor: currentEstimate.tax_total_minor,
                deposit_requested_minor:
                  currentEstimate.deposit_requested_minor,
                total_minor: currentEstimate.total_minor,
                amount_paid_minor: 0,
                amount_refunded_minor: 0,
                amount_disputed_minor: 0,
                balance_due_minor: currentEstimate.total_minor,
                email_state: 'not_sent',
                sync_state: 'not_synced',
                // Invoice collection is independent from whether the estimate
                // accepted payments or deposits.
                online_payments_enabled: true,
                auto_generate_invoice_enabled: false,
                contract_template_id: currentEstimate.contract_template_id,
                contract_snapshot: currentEstimate.contract_snapshot,
                show_client_signature: currentEstimate.show_client_signature,
                show_company_signature: currentEstimate.show_company_signature,
                customer_notes:
                  dto?.customer_notes ?? currentEstimate.customer_notes,
                private_notes:
                  dto?.private_notes ?? currentEstimate.private_notes,
                document_photo_asset_ids: [],
                attachment_asset_ids: [],
                version: 1,
                frozen_revision_number: null,
                frozen_hash: null,
              },
            ],
            { session },
          );

          invoiceDoc = createdInvoice;
        } catch (error: unknown) {
          // Concurrent convert: unique index on source_estimate_id won — return
          // the winner instead of allocating another number / failing the client.
          if (this.isDuplicateKey(error)) {
            const winner = await this.documentModel
              .findOne(
                {
                  organization_id: orgObjectId,
                  type: 'invoice',
                  source_estimate_id: estObjectId,
                },
                null,
                { session },
              )
              .exec();
            if (winner) {
              invoiceDoc = winner;
              return;
            }
          }
          throw error;
        }

        const estimateClaim = await this.documentModel
          .updateOne(
            {
              _id: currentEstimate._id,
              organization_id: orgObjectId,
              type: 'estimate',
              status: { $in: ['pending', 'approved'] },
            },
            {
              $set: { status: 'approved' },
              $inc: { version: 1 },
            },
            { session },
          )
          .exec();
        if (estimateClaim.matchedCount !== 1) {
          throw new ConflictException({
            code: 'ESTIMATE_NOT_CONVERTIBLE',
            message:
              'Estimate status changed while the invoice was being generated. Refresh and try again.',
          });
        }

        await this.auditLogModel.create(
          [
            {
              organization_id: orgObjectId,
              actor_user_id: asObjectId(actor.user_id, 'user id'),
              action: 'estimate.converted_to_invoice',
              entity_type: 'estimate',
              entity_id: String(currentEstimate._id),
              before_json: { status: currentEstimate.status },
              after_json: {
                invoice_id: String(invoiceDoc._id),
                invoice_number: invoiceDoc.number,
                status: 'approved',
              },
            },
          ],
          { session },
        );
      });
    } finally {
      await session.endSession();
    }

    if (!invoiceDoc) {
      // Race lost the create but winner may already be visible outside the txn.
      const winner = await this.documentModel
        .findOne({
          organization_id: orgObjectId,
          type: 'invoice',
          source_estimate_id: estObjectId,
        })
        .exec();
      if (winner) {
        invoiceDoc = winner;
      } else {
        throw new ConflictException('Invoice conversion failed');
      }
    }

    const createdInvoice = invoiceDoc;
    await this.documentModel
      .updateOne(
        {
          _id: estimate._id,
          organization_id: orgObjectId,
          type: 'estimate',
          status: { $in: ['pending', 'invoiced'] },
        },
        { $set: { status: 'approved' }, $inc: { version: 1 } },
      )
      .exec();
    await this.assetsService.cloneDocumentAssets(
      estimate,
      createdInvoice,
      actor.user_id,
    );
    invoiceDoc =
      (await this.documentModel.findById(createdInvoice._id).exec()) ??
      createdInvoice;

    return this.documentsService.serialize(invoiceDoc);
  }

  private isDuplicateKey(error: unknown) {
    return (
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      (error as { code?: number }).code === 11000
    );
  }
}
