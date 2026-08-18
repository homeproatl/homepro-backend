import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { UserRole } from '../common/enums/user-role.enum';
import type { AuthActor } from '../common/types/auth-actor';
import { asObjectId } from '../common/utils/object-id';
import { withOrganizationScope } from '../common/utils/organization-scope';
import { DocumentAccessGrantsService } from '../documents/document-access-grants.service';
import { DocumentEmailOutboxService } from '../documents/document-email-outbox.service';
import { DocumentPdfService } from '../documents/document-pdf.service';
import {
  buildDocumentRendererModel,
  type DocumentRendererModel,
} from '../documents/document-renderer';
import {
  generateAccessToken,
  hashAccessToken,
} from '../documents/document-token.crypto';
import type { CreateDocumentDto } from '../documents/dto/create-document.dto';
import { DocumentsService } from '../documents/documents.service';
import type { DocumentGrantPermission } from '../documents/schemas/document-access-grant.schema';
import {
  DocumentEvent,
  DocumentEventDocument,
} from '../documents/schemas/document-event.schema';
import { DocumentEmailOutboxDocument } from '../documents/schemas/document-email-outbox.schema';
import {
  OrgDocument,
  OrgDocumentDocument,
} from '../documents/schemas/document.schema';
import { SettingsService } from '../settings/settings.service';
import {
  SignatureEvidence,
  SignatureEvidenceDocument,
} from '../documents/schemas/signature-evidence.schema';
import {
  computeInvoicePaymentDisplay,
  type InvoicePaymentDisplay,
} from './invoice-payment-state';
import { StripePaymentsService } from './stripe-payments.service';

const INVOICE_GRANT_PERMISSIONS: DocumentGrantPermission[] = [
  'view',
  'download',
  'pay',
];

const MAX_INVOICE_PDF_BYTES = 5 * 1024 * 1024;

export type InvoiceSendPayload = {
  recipient_email?: string;
  subject?: string;
  message?: string;
  idempotency_key?: string;
};

export type InvoiceReadiness = {
  can_issue: boolean;
  can_send: boolean;
  blockers: string[];
};

@Injectable()
export class InvoiceWorkflowService {
  constructor(
    private readonly documentsService: DocumentsService,
    private readonly pdfService: DocumentPdfService,
    private readonly accessGrants: DocumentAccessGrantsService,
    private readonly emailOutbox: DocumentEmailOutboxService,
    private readonly configService: ConfigService,
    private readonly settingsService: SettingsService,
    private readonly stripePayments: StripePaymentsService,
    @InjectModel(OrgDocument.name)
    private readonly documentModel: Model<OrgDocumentDocument>,
    @InjectModel(DocumentEvent.name)
    private readonly documentEventModel: Model<DocumentEventDocument>,
    @InjectModel(SignatureEvidence.name)
    private readonly signatureEvidenceModel: Model<SignatureEvidenceDocument>,
  ) {}

  async getPreview(id: string, actor: AuthActor) {
    const doc = await this.requireInvoiceEntity(id, actor.organization_id);
    const includeInternalFields = actor.role === UserRole.ADMIN;
    const signature = await this.findLatestSignature(
      actor.organization_id,
      String(doc._id),
    );
    const payment_display = this.paymentDisplayFor(doc);
    const readiness = this.buildReadiness(doc);

    return {
      document: this.documentsService.serializeForEdit(doc, {
        includeInternalFields,
      }),
      renderer: this.toRenderer(doc, signature),
      payment_display,
      readiness,
    };
  }

  async getPdf(id: string, actor: AuthActor) {
    const doc = await this.requireInvoiceEntity(id, actor.organization_id);
    const signature = await this.findLatestSignature(
      actor.organization_id,
      String(doc._id),
    );
    return this.pdfService.renderPdf(this.toRenderer(doc, signature));
  }

  async getLatest(id: string, actor: AuthActor) {
    const doc = await this.requireInvoiceEntity(id, actor.organization_id);
    const includeInternalFields = actor.role === UserRole.ADMIN;
    const payment_display = this.paymentDisplayFor(doc);
    const readiness = this.buildReadiness(doc);
    const full = this.documentsService.serializeForEdit(doc, {
      includeInternalFields,
    });
    const summary: Omit<typeof full, 'line_items'> = {
      ...full,
    };
    delete (summary as Partial<typeof full>).line_items;

    return {
      document: {
        ...summary,
        line_item_count: (doc.line_items ?? []).length,
      },
      payment_display,
      readiness,
      timestamps: {
        created_at: doc.created_at?.toISOString?.() ?? null,
        updated_at: doc.updated_at?.toISOString?.() ?? null,
        issued_at: await this.findStatusTimestamp(
          actor.organization_id,
          doc._id,
          'issued',
        ),
        sent_at: await this.findStatusTimestamp(
          actor.organization_id,
          doc._id,
          'sent',
        ),
      },
    };
  }

  async getHistory(id: string, actor: AuthActor) {
    const doc = await this.requireInvoiceEntity(id, actor.organization_id);

    const events = await this.documentEventModel
      .find(
        withOrganizationScope(actor.organization_id, {
          document_id: doc._id,
        }),
      )
      .sort({ occurred_at: -1 })
      .lean()
      .exec();

    const dispatches = await this.emailOutbox.listSafeForDocument(
      actor.organization_id,
      String(doc._id),
    );

    return {
      events: events.map((event) => ({
        id: String(event._id),
        action: event.action,
        old_status: event.old_status ?? null,
        new_status: event.new_status ?? null,
        metadata: event.metadata ?? {},
        actor_user_id: event.actor_user_id ? String(event.actor_user_id) : null,
        public_grant_id: event.public_grant_id
          ? String(event.public_grant_id)
          : null,
        occurred_at:
          event.occurred_at instanceof Date
            ? event.occurred_at.toISOString()
            : event.occurred_at,
      })),
      dispatches: dispatches.map((row) => ({
        id: String(row._id),
        status: row.status,
        recipient_email: row.recipient_email,
        template_key: row.template_key,
        document_version: row.document_version,
        document_hash: row.document_hash,
        attempt_count: row.attempt_count,
        provider_message_id: row.provider_message_id,
        last_error: row.last_error,
        sent_at: row.sent_at?.toISOString?.() ?? null,
        created_at: row.created_at?.toISOString?.() ?? null,
        updated_at: row.updated_at?.toISOString?.() ?? null,
      })),
      payments: {
        amount_paid_minor: doc.amount_paid_minor,
        amount_refunded_minor: doc.amount_refunded_minor,
        amount_disputed_minor: doc.amount_disputed_minor,
        balance_due_minor: doc.balance_due_minor,
        payment_display: this.paymentDisplayFor(doc),
      },
    };
  }

  async issue(id: string, actor: AuthActor, version: number) {
    const doc = await this.requireInvoiceEntity(id, actor.organization_id);
    if (doc.status !== 'draft') {
      throw new ConflictException({
        code: 'INVOICE_NOT_DRAFT',
        message: `Cannot issue invoice in status '${doc.status}'. Only draft invoices can be issued.`,
      });
    }

    const readiness = this.buildReadiness(doc);
    if (!readiness.can_issue) {
      throw new BadRequestException({
        code: 'INVOICE_NOT_READY',
        message: readiness.blockers.join(' '),
        blockers: readiness.blockers,
      });
    }

    return this.documentsService.transitionStatus(
      id,
      { status: 'issued', version },
      actor.organization_id,
      actor.user_id,
    );
  }

  async send(id: string, actor: AuthActor, payload: InvoiceSendPayload = {}) {
    let working = await this.requireInvoiceEntity(id, actor.organization_id);

    if (working.amount_paid_minor > 0 && working.balance_due_minor <= 0) {
      throw new ConflictException({
        code: 'INVOICE_ALREADY_PAID',
        message:
          'This invoice is paid in full and cannot be sent as a payment request.',
      });
    }

    // Atomic issue-and-send: draft invoices are issued first, then sent.
    if (working.status === 'draft') {
      await this.issue(id, actor, working.version);
      working = await this.requireInvoiceEntity(id, actor.organization_id);
    }

    if (working.status === 'void' || working.status === 'archived') {
      throw new ConflictException({
        code: 'INVOICE_NOT_SENDABLE',
        message: `Cannot send invoice in status '${working.status}'.`,
      });
    }

    const readiness = this.buildReadiness(working);
    if (readiness.blockers.length > 0) {
      throw new BadRequestException({
        code: 'INVOICE_NOT_READY',
        message: readiness.blockers.join(' '),
        blockers: readiness.blockers,
      });
    }

    if (!working.frozen_hash || !working.frozen_revision_number) {
      throw new ConflictException({
        code: 'INVOICE_NOT_FROZEN',
        message: 'Invoice must be issued (frozen) before it can be sent.',
      });
    }

    const recipient =
      payload.recipient_email?.trim().toLowerCase() ||
      working.client_snapshot?.email?.trim().toLowerCase() ||
      '';
    if (!recipient || !recipient.includes('@')) {
      throw new BadRequestException({
        code: 'INVOICE_MISSING_RECIPIENT',
        message: 'A valid client email is required to send the invoice.',
        blockers: ['Client email is required to send.'],
      });
    }

    const version = working.frozen_revision_number;
    const hash = working.frozen_hash;
    const settings = await this.settingsService.getAppSettings(
      actor.organization_id,
      actor.role,
    );
    const idempotencyKey =
      payload.idempotency_key?.trim() ||
      `invoice-send:${String(working._id)}:v${version}:${recipient}`;

    const existingOutbox =
      await this.emailOutbox.findByIdempotencyKey(idempotencyKey);
    if (existingOutbox) {
      // Crash recovery: outbox may exist without a matching grant.
      await this.ensureGrantForOutbox(existingOutbox, actor);
      return {
        document: this.documentsService.serialize(working),
        payment_display: this.paymentDisplayFor(working),
        status: working.status,
        email: {
          outbox_id: String(existingOutbox._id),
          status: existingOutbox.status,
          recipient_email: recipient,
          idempotency_key: idempotencyKey,
        },
        public_url: null,
      };
    }

    const signature = await this.findLatestSignature(
      actor.organization_id,
      String(working._id),
    );
    const renderer = this.toRenderer(working, signature);
    const pdf = await this.pdfService.renderPdf(renderer);
    if (pdf.buffer.byteLength > MAX_INVOICE_PDF_BYTES) {
      throw new BadRequestException({
        code: 'INVOICE_PDF_TOO_LARGE',
        message: `Generated PDF exceeds the ${MAX_INVOICE_PDF_BYTES} byte send limit.`,
      });
    }

    // Claim the idempotency key first, then install the matching grant so a
    // concurrent loser does not rotate away the winning outbox token.
    await this.stripePayments.prepareForInvoiceMutation(id, actor);
    const token = generateAccessToken();
    const publicUrl = this.buildPublicInvoiceUrl(token);

    const { row: outbox, created } = await this.emailOutbox.enqueue({
      organizationId: actor.organization_id,
      documentId: String(working._id),
      documentVersion: version,
      documentHash: hash,
      recipientEmail: recipient,
      templateKey: 'invoice.send',
      idempotencyKey,
      token,
      publicUrl,
      pdfBuffer: pdf.buffer,
      emailSnapshot: {
        company_name: working.company_snapshot?.display_name ?? 'Company',
        client_display_name: working.client_snapshot?.display_name ?? 'Client',
        document_number: working.number,
        total_minor: working.total_minor,
        subject: payload.subject?.trim() || null,
        message:
          payload.message?.trim() ||
          settings.documents.default_invoice_email_message ||
          null,
      },
    });

    if (!created) {
      await this.ensureGrantForOutbox(outbox, actor);
      return {
        document: this.documentsService.serialize(working),
        payment_display: this.paymentDisplayFor(working),
        status: working.status,
        email: {
          outbox_id: String(outbox._id),
          status: outbox.status,
          recipient_email: recipient,
          idempotency_key: idempotencyKey,
        },
        public_url: null,
      };
    }

    const grant = await this.accessGrants.installGrant({
      organizationId: actor.organization_id,
      documentId: String(working._id),
      createdByUserId: actor.user_id,
      token,
      permissions: INVOICE_GRANT_PERMISSIONS,
    });

    let status = working.status;
    const priorStatus = working.status;
    if (working.status === 'issued') {
      const sent = await this.documentsService.transitionStatus(
        id,
        { status: 'sent', version: working.version },
        actor.organization_id,
        actor.user_id,
      );
      status = sent.status;
      working = await this.requireInvoiceEntity(id, actor.organization_id);
    }

    await this.appendEvent({
      organizationId: actor.organization_id,
      documentId: working._id,
      actorUserId: actor.user_id,
      publicGrantId: grant._id,
      action: 'send',
      oldStatus: priorStatus,
      newStatus: status,
      metadata: {
        outbox_id: String(outbox._id),
        recipient_email: recipient,
        document_version: version,
      },
    });

    void this.emailOutbox.processDue(3);

    return {
      document: this.documentsService.serialize(working),
      payment_display: this.paymentDisplayFor(working),
      status,
      email: {
        outbox_id: String(outbox._id),
        status: outbox.status,
        recipient_email: recipient,
        idempotency_key: idempotencyKey,
      },
      public_url: publicUrl,
    };
  }

  /**
   * If enqueue won but the process crashed before installGrant, a later retry
   * must install the grant for the encrypted outbox token (never a new token).
   */
  private async ensureGrantForOutbox(
    outbox: DocumentEmailOutboxDocument,
    actor: AuthActor,
  ) {
    const payload = this.emailOutbox.peekPublicPayload(outbox);
    if (!payload?.token) {
      return;
    }
    const existing = await this.accessGrants.findActiveByTokenHash(
      hashAccessToken(payload.token),
    );
    if (existing) {
      return existing;
    }
    return this.accessGrants.installGrant({
      organizationId: actor.organization_id,
      documentId: String(outbox.document_id),
      createdByUserId: actor.user_id,
      token: payload.token,
      permissions: INVOICE_GRANT_PERMISSIONS,
    });
  }

  async voidInvoice(id: string, actor: AuthActor, version: number) {
    await this.requireInvoiceEntity(id, actor.organization_id);
    return this.documentsService.transitionStatus(
      id,
      { status: 'void', version },
      actor.organization_id,
      actor.user_id,
    );
  }

  async duplicate(id: string, actor: AuthActor) {
    const source = await this.requireInvoiceEntity(id, actor.organization_id);
    const payload = this.toCreateDtoFromInvoice(source);
    const created = await this.documentsService.create(
      payload,
      actor.organization_id,
      actor.user_id,
    );
    return created;
  }

  async createAccessGrant(
    id: string,
    actor: AuthActor,
    options: { expires_at?: string | null } = {},
  ) {
    return this.rotateAccessGrant(id, actor, options);
  }

  async rotateAccessGrant(
    id: string,
    actor: AuthActor,
    options: { expires_at?: string | null } = {},
  ) {
    const doc = await this.requireInvoiceEntity(id, actor.organization_id);
    const expiresAt = options.expires_at ? new Date(options.expires_at) : null;
    if (expiresAt && Number.isNaN(expiresAt.getTime())) {
      throw new BadRequestException('Invalid expires_at');
    }

    await this.stripePayments.prepareForInvoiceMutation(id, actor);

    const { grant, token } = await this.accessGrants.rotateGrant({
      organizationId: actor.organization_id,
      documentId: String(doc._id),
      createdByUserId: actor.user_id,
      permissions: INVOICE_GRANT_PERMISSIONS,
      expiresAt,
    });

    await this.appendEvent({
      organizationId: actor.organization_id,
      documentId: doc._id,
      actorUserId: actor.user_id,
      publicGrantId: grant._id,
      action: 'send',
      oldStatus: doc.status,
      newStatus: doc.status,
      metadata: {
        purpose: 'public_grant_rotated',
        grant_id: String(grant._id),
      },
    });

    return {
      grant_id: String(grant._id),
      permissions: grant.permissions,
      expires_at: grant.expires_at?.toISOString?.() ?? null,
      public_url: this.buildPublicInvoiceUrl(token),
    };
  }

  private buildReadiness(doc: OrgDocumentDocument): InvoiceReadiness {
    const blockers: string[] = [];
    if ((doc.amount_paid_minor ?? 0) > 0 && (doc.balance_due_minor ?? 0) <= 0) {
      blockers.push('Paid invoices cannot be sent again.');
    }
    const email = doc.client_snapshot?.email?.trim() ?? '';
    if (!email || !email.includes('@')) {
      blockers.push('Client email is required to send.');
    }
    if ((doc.line_items ?? []).length < 1) {
      blockers.push('At least one line item is required.');
    }
    if ((doc.total_minor ?? 0) <= 0) {
      blockers.push('Invoice total must be greater than zero.');
    }
    const companyName = doc.company_snapshot?.display_name?.trim() ?? '';
    if (!companyName) {
      blockers.push('Company display name is required.');
    }

    const structuralOk = blockers.length === 0;
    const can_issue = doc.status === 'draft' && structuralOk;
    const can_send =
      structuralOk &&
      (doc.status === 'draft' ||
        doc.status === 'issued' ||
        doc.status === 'sent');

    return { can_issue, can_send, blockers };
  }

  private paymentDisplayFor(doc: OrgDocumentDocument): InvoicePaymentDisplay {
    return computeInvoicePaymentDisplay({
      total_minor: doc.total_minor,
      amount_paid_minor: doc.amount_paid_minor,
      amount_refunded_minor: doc.amount_refunded_minor,
      amount_disputed_minor: doc.amount_disputed_minor,
      balance_due_minor: doc.balance_due_minor,
      due_date: doc.due_date,
      status: doc.status,
    });
  }

  private toCreateDtoFromInvoice(doc: OrgDocumentDocument): CreateDocumentDto {
    return {
      type: 'invoice',
      client_id: String(doc.client_id),
      po_number: doc.po_number ?? null,
      job_name: doc.job_name ?? null,
      service_address_snapshot: doc.service_address_snapshot
        ? {
            street: doc.service_address_snapshot.street ?? null,
            suite: doc.service_address_snapshot.suite ?? null,
            city: doc.service_address_snapshot.city ?? null,
            state: doc.service_address_snapshot.state ?? null,
            postal_code: doc.service_address_snapshot.postal_code ?? null,
            country: doc.service_address_snapshot.country ?? null,
          }
        : null,
      issue_date: null,
      expiration_date: null,
      due_date: doc.due_date?.toISOString?.() ?? null,
      // Duplicates are independent drafts; do not re-link source estimate
      // (conversion uniqueness is on source_estimate_id).
      contract_template_id: doc.contract_template_id
        ? String(doc.contract_template_id)
        : null,
      show_client_signature: doc.show_client_signature,
      show_company_signature: doc.show_company_signature,
      customer_notes: doc.customer_notes ?? null,
      private_notes: doc.private_notes ?? null,
      deposit_requested_minor: doc.deposit_requested_minor ?? 0,
      line_items: (doc.line_items ?? []).map((line, index) => ({
        item_id: line.item_id ? String(line.item_id) : null,
        sort_order: line.sort_order ?? index,
        line_type: line.line_type,
        description: line.description,
        notes: line.notes ?? null,
        unit_of_measure: line.unit_of_measure ?? null,
        sku_or_part_number: line.sku_or_part_number ?? null,
        vendor_name: line.vendor_name ?? null,
        purchase_status: line.purchase_status,
        internal_unit_cost_minor: line.internal_unit_cost_minor ?? null,
        waste_basis_points: line.waste_basis_points ?? 0,
        rate_minor: line.rate_minor,
        quantity_milli: line.quantity_milli,
        markup_type: line.markup_type,
        markup_value: line.markup_value,
        discount_type: line.discount_type,
        discount_value: line.discount_value,
        taxable: line.taxable,
        tax_id: line.tax_id ? String(line.tax_id) : null,
      })),
    };
  }

  private toRenderer(
    doc: OrgDocumentDocument,
    signature: SignatureEvidenceDocument | null,
  ): DocumentRendererModel {
    return buildDocumentRendererModel(doc as never, {
      clientSignature: signature
        ? {
            signer_name: signature.signer_name,
            signed_at: signature.signed_at,
          }
        : null,
    });
  }

  private async requireInvoiceEntity(id: string, organizationId: string) {
    const doc = await this.documentModel
      .findOne(
        withOrganizationScope(organizationId, {
          _id: asObjectId(id, 'document id'),
          type: 'invoice' as const,
        }),
      )
      .exec();
    if (!doc) {
      throw new NotFoundException('Invoice not found');
    }
    return doc;
  }

  private async findLatestSignature(
    organizationId: string,
    documentId: string,
  ): Promise<SignatureEvidenceDocument | null> {
    return this.signatureEvidenceModel
      .findOne(
        withOrganizationScope(organizationId, {
          document_id: asObjectId(documentId, 'document id'),
        }),
      )
      .sort({ signed_at: -1 })
      .exec();
  }

  private async findStatusTimestamp(
    organizationId: string,
    documentId: Types.ObjectId,
    status: string,
  ): Promise<string | null> {
    const event = await this.documentEventModel
      .findOne(
        withOrganizationScope(organizationId, {
          document_id: documentId,
          new_status: status,
        }),
      )
      .sort({ occurred_at: -1 })
      .exec();
    return event?.occurred_at?.toISOString?.() ?? null;
  }

  private buildPublicInvoiceUrl(token: string) {
    const base =
      this.configService.get<string>('PUBLIC_APP_BASE_URL') ??
      this.configService.get<string>('FRONTEND_ORIGIN');
    if (!base) {
      throw new BadRequestException(
        'PUBLIC_APP_BASE_URL or FRONTEND_ORIGIN is required to build public invoice links',
      );
    }
    return `${base.replace(/\/$/, '')}/view/invoice/${token}`;
  }

  private async appendEvent(input: {
    organizationId: string;
    documentId: Types.ObjectId;
    actorUserId: string | null;
    publicGrantId: Types.ObjectId | null;
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
      public_grant_id: input.publicGrantId,
      action: input.action,
      old_status: input.oldStatus,
      new_status: input.newStatus,
      metadata: input.metadata ?? {},
      occurred_at: new Date(),
    });
  }
}
