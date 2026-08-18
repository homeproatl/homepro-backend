import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleDestroy,
  OnModuleInit,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import type { AuthActor } from '../common/types/auth-actor';
import { UserRole } from '../common/enums/user-role.enum';
import { AssetsService } from '../assets/assets.service';
import { asObjectId } from '../common/utils/object-id';
import { withOrganizationScope } from '../common/utils/organization-scope';
import type { CreatePublicGrantDto } from '../estimates/dto/create-public-grant.dto';
import type { PublicSignEstimateDto } from '../estimates/dto/public-sign-estimate.dto';
import type { SendEstimateDocumentDto } from '../estimates/dto/send-estimate-document.dto';
import { DocumentAccessGrantsService } from './document-access-grants.service';
import { DocumentEmailOutboxService } from './document-email-outbox.service';
import { DocumentPdfService } from './document-pdf.service';
import {
  buildDocumentRendererModel,
  type DocumentRendererModel,
} from './document-renderer';
import { generateAccessToken } from './document-token.crypto';
import { DocumentsService } from './documents.service';
import { SettingsService } from '../settings/settings.service';
import { Payment, PaymentDocument } from '../invoices/schemas/payment.schema';
import {
  DocumentEvent,
  DocumentEventDocument,
} from './schemas/document-event.schema';
import { OrgDocument, OrgDocumentDocument } from './schemas/document.schema';
import {
  SignatureEvidence,
  SignatureEvidenceDocument,
} from './schemas/signature-evidence.schema';

export type PublicRequestMeta = {
  ipAddress: string | null;
  userAgent: string | null;
};

@Injectable()
export class DocumentPresentationService
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(DocumentPresentationService.name);
  private workerTimer: ReturnType<typeof setInterval> | null = null;

  constructor(
    private readonly documentsService: DocumentsService,
    private readonly accessGrants: DocumentAccessGrantsService,
    private readonly emailOutbox: DocumentEmailOutboxService,
    private readonly pdfService: DocumentPdfService,
    private readonly configService: ConfigService,
    private readonly settingsService: SettingsService,
    private readonly assetsService: AssetsService,
    @InjectModel(OrgDocument.name)
    private readonly documentModel: Model<OrgDocumentDocument>,
    @InjectModel(DocumentEvent.name)
    private readonly documentEventModel: Model<DocumentEventDocument>,
    @InjectModel(SignatureEvidence.name)
    private readonly signatureEvidenceModel: Model<SignatureEvidenceDocument>,
    @InjectModel(Payment.name)
    private readonly paymentModel: Model<PaymentDocument>,
  ) {}

  onModuleInit() {
    this.workerTimer = setInterval(() => {
      void this.emailOutbox.processDue(5).catch((error) => {
        this.logger.warn(
          `Outbox worker tick failed: ${
            error instanceof Error ? error.message : 'unknown'
          }`,
        );
      });
    }, 5_000);
    this.workerTimer.unref?.();
  }

  onModuleDestroy() {
    if (this.workerTimer) {
      clearInterval(this.workerTimer);
      this.workerTimer = null;
    }
  }

  async getAdminPreview(id: string, actor: AuthActor) {
    const doc = await this.requireEstimateEntity(id, actor.organization_id);
    const signature = await this.findLatestSignature(
      actor.organization_id,
      String(doc._id),
    );
    const includeInternalFields = actor.role === UserRole.ADMIN;
    return {
      document: this.documentsService.serializeForEdit(doc, {
        includeInternalFields,
      }),
      renderer: this.toRenderer(doc, signature),
    };
  }

  async createPublicGrant(
    id: string,
    actor: AuthActor,
    payload: CreatePublicGrantDto = {},
  ) {
    const doc = await this.requireEstimateEntity(id, actor.organization_id);
    const expiresAt = payload.expires_at ? new Date(payload.expires_at) : null;
    if (expiresAt && Number.isNaN(expiresAt.getTime())) {
      throw new BadRequestException('Invalid expires_at');
    }

    const { grant, token } = await this.accessGrants.rotateGrant({
      organizationId: actor.organization_id,
      documentId: String(doc._id),
      createdByUserId: actor.user_id,
      expiresAt,
    });

    await this.appendPublicEvent({
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
      public_url: this.buildPublicUrl(token),
    };
  }

  async sendEstimate(
    id: string,
    actor: AuthActor,
    payload: SendEstimateDocumentDto,
  ) {
    const recipient = payload.recipient_email.trim().toLowerCase();
    const doc = await this.requireEstimateEntity(id, actor.organization_id);
    let working = doc;

    if (working.status === 'draft') {
      await this.documentsService.transitionStatus(
        id,
        { status: 'pending', version: working.version },
        actor.organization_id,
        actor.user_id,
      );
      working = await this.requireEstimateEntity(id, actor.organization_id);
    }

    if (!working.frozen_hash || !working.frozen_revision_number) {
      throw new ConflictException({
        code: 'ESTIMATE_NOT_FROZEN',
        message:
          'Estimate must be frozen (pending or later) before it can be sent.',
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
      `estimate-send:${String(working._id)}:v${version}:${recipient}`;

    const existingOutbox =
      await this.emailOutbox.findByIdempotencyKey(idempotencyKey);
    if (existingOutbox) {
      const signature = await this.findLatestSignature(
        actor.organization_id,
        String(working._id),
      );
      return {
        renderer: this.toRenderer(working, signature),
        status: working.status,
        email: {
          outbox_id: String(existingOutbox._id),
          status: existingOutbox.status,
          recipient_email: recipient,
          idempotency_key: idempotencyKey,
        },
        // Idempotent replay: do not re-expose share URL.
        public_url: null,
      };
    }

    // Claim the idempotency key first, then install the matching grant so a
    // concurrent loser does not rotate away the winning outbox token.
    const token = generateAccessToken();
    const publicUrl = this.buildPublicUrl(token);
    const signature = await this.findLatestSignature(
      actor.organization_id,
      String(working._id),
    );
    const pdf = await this.pdfService.renderPdf(
      this.toRenderer(working, signature),
    );

    const { row: outbox, created } = await this.emailOutbox.enqueue({
      organizationId: actor.organization_id,
      documentId: String(working._id),
      documentVersion: version,
      documentHash: hash,
      recipientEmail: recipient,
      templateKey: 'estimate.send',
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
          settings.documents.default_estimate_email_message ||
          null,
      },
    });

    if (!created) {
      const signature = await this.findLatestSignature(
        actor.organization_id,
        String(working._id),
      );
      return {
        renderer: this.toRenderer(working, signature),
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
    });

    await this.appendPublicEvent({
      organizationId: actor.organization_id,
      documentId: working._id,
      actorUserId: actor.user_id,
      publicGrantId: grant._id,
      action: 'send',
      oldStatus: doc.status,
      newStatus: working.status,
      metadata: {
        outbox_id: String(outbox._id),
        recipient_email: recipient,
        document_version: version,
      },
    });

    void this.emailOutbox.processDue(3);

    return {
      renderer: this.toRenderer(working, signature),
      status: working.status,
      email: {
        outbox_id: String(outbox._id),
        status: outbox.status,
        recipient_email: recipient,
        idempotency_key: idempotencyKey,
      },
      public_url: publicUrl,
    };
  }

  async getAdminPdf(id: string, actor: AuthActor) {
    const doc = await this.requireEstimateEntity(id, actor.organization_id);
    const signature = await this.findLatestSignature(
      actor.organization_id,
      String(doc._id),
    );
    return this.pdfService.renderPdf(this.toRenderer(doc, signature));
  }

  async getPublicView(token: string) {
    const grant = await this.accessGrants.findValidGrantByToken(token);
    this.accessGrants.assertPermission(grant, 'view');
    await this.accessGrants.touchAccess(grant._id);

    const doc = await this.loadDocumentForGrant(grant);
    const signature = await this.findLatestSignature(
      String(grant.organization_id),
      String(doc._id),
    );

    await this.appendPublicEvent({
      organizationId: String(grant.organization_id),
      documentId: doc._id,
      actorUserId: null,
      publicGrantId: grant._id,
      action: 'view',
      oldStatus: doc.status,
      newStatus: doc.status,
      metadata: {},
    });

    return {
      renderer: this.toRenderer(doc, signature),
      status: doc.status,
      can_approve: grant.permissions.includes('approve'),
      can_decline: grant.permissions.includes('decline'),
      can_sign: grant.permissions.includes('sign'),
    };
  }

  async getPublicPdf(token: string) {
    const grant = await this.accessGrants.findValidGrantByToken(token);
    this.accessGrants.assertPermission(grant, 'download');
    await this.accessGrants.touchAccess(grant._id);
    const doc = await this.loadDocumentForGrant(grant);
    const signature = await this.findLatestSignature(
      String(grant.organization_id),
      String(doc._id),
    );
    return this.pdfService.renderPdf(this.toRenderer(doc, signature));
  }

  async getPublicAsset(token: string, assetId: string) {
    const grant = await this.accessGrants.findValidGrantByToken(token);
    this.accessGrants.assertPermission(grant, 'view');
    const doc = await this.loadDocumentForGrant(grant);
    const requestedId = asObjectId(assetId, 'asset id');
    const allowed = [
      ...(doc.document_photo_asset_ids ?? []),
      ...(doc.attachment_asset_ids ?? []),
      ...(doc.line_items ?? []).flatMap((line) => line.photo_asset_ids ?? []),
    ].some((id) => String(id) === String(requestedId));
    if (!allowed) {
      throw new UnauthorizedException('Invalid or expired link');
    }
    await this.accessGrants.touchAccess(grant._id);
    return this.assetsService.readPublicContent(
      String(requestedId),
      String(grant.organization_id),
    );
  }

  /** Public invoice view — view/download only (no approve/pay in Step 12). */
  async getPublicInvoiceView(token: string) {
    const grant = await this.accessGrants.findValidGrantByToken(token);
    this.accessGrants.assertPermission(grant, 'view');
    await this.accessGrants.touchAccess(grant._id);

    const doc = await this.loadInvoiceDocumentForGrant(grant);
    const signature = await this.findLatestSignature(
      String(grant.organization_id),
      String(doc._id),
    );

    await this.appendPublicEvent({
      organizationId: String(grant.organization_id),
      documentId: doc._id,
      actorUserId: null,
      publicGrantId: grant._id,
      action: 'view',
      oldStatus: doc.status,
      newStatus: doc.status,
      metadata: {},
    });

    return {
      renderer: this.toRenderer(doc, signature),
      status: doc.status,
      permissions: grant.permissions,
      can_download: grant.permissions.includes('download'),
      payment: await this.getPublicInvoicePaymentReadiness(
        doc,
        grant.permissions,
      ),
    };
  }

  async getPublicInvoicePdf(token: string) {
    const grant = await this.accessGrants.findValidGrantByToken(token);
    this.accessGrants.assertPermission(grant, 'download');
    await this.accessGrants.touchAccess(grant._id);
    const doc = await this.loadInvoiceDocumentForGrant(grant);
    const signature = await this.findLatestSignature(
      String(grant.organization_id),
      String(doc._id),
    );
    return this.pdfService.renderPdf(this.toRenderer(doc, signature));
  }

  private async getPublicInvoicePaymentReadiness(
    doc: OrgDocumentDocument,
    permissions: string[],
  ) {
    const onlinePaymentsEnabled = this.booleanConfig(
      'ONLINE_INVOICE_PAYMENTS_ENABLED',
      false,
    );
    const stripeConfigured =
      Boolean(this.configService.get<string>('STRIPE_SECRET_KEY')?.trim()) &&
      Boolean(
        this.configService.get<string>('STRIPE_WEBHOOK_SECRET')?.trim(),
      ) &&
      Boolean(
        (
          this.configService.get<string>('PUBLIC_APP_BASE_URL') ??
          this.configService.get<string>('FRONTEND_ORIGIN') ??
          ''
        ).trim(),
      );
    const hasClientEmail = Boolean(doc.client_snapshot.email?.trim());
    const paymentProcessing = Boolean(
      await this.paymentModel
        .exists({
          organization_id: doc.organization_id,
          document_id: doc._id,
          provider: 'stripe',
          status: 'processing',
        })
        .exec(),
    );
    const canPay =
      permissions.includes('pay') &&
      onlinePaymentsEnabled &&
      stripeConfigured &&
      doc.online_payments_enabled &&
      doc.status !== 'void' &&
      doc.balance_due_minor > 0 &&
      hasClientEmail &&
      !paymentProcessing;

    return {
      can_pay: canPay,
      amount_due_minor: doc.balance_due_minor,
      currency: 'usd',
      processing: paymentProcessing,
      disabled_reason: canPay
        ? null
        : this.resolveInvoicePaymentDisabledReason({
            permissions,
            onlinePaymentsEnabled,
            stripeConfigured,
            paymentProcessing,
            doc,
            hasClientEmail,
          }),
    };
  }

  private resolveInvoicePaymentDisabledReason(input: {
    permissions: string[];
    onlinePaymentsEnabled: boolean;
    stripeConfigured: boolean;
    paymentProcessing: boolean;
    doc: OrgDocumentDocument;
    hasClientEmail: boolean;
  }) {
    if (!input.permissions.includes('pay')) {
      return 'This invoice link does not allow online payment.';
    }
    if (!input.onlinePaymentsEnabled) {
      return 'Online payments are not available yet.';
    }
    if (!input.stripeConfigured) {
      return 'Online payments are not fully configured yet.';
    }
    if (!input.doc.online_payments_enabled) {
      return 'Online payments are not enabled for this invoice.';
    }
    if (input.paymentProcessing) {
      return 'A payment is processing. The balance will update after Stripe confirms it.';
    }
    if (input.doc.status === 'void') {
      return 'This invoice is void.';
    }
    if (input.doc.balance_due_minor <= 0) {
      return 'This invoice has no balance due.';
    }
    if (!input.hasClientEmail) {
      return 'This invoice is missing a client email.';
    }
    return null;
  }

  private booleanConfig(key: string, fallback: boolean) {
    const value = this.configService.get<string>(key);
    if (value == null || value === '') {
      return fallback;
    }
    return ['true', '1', 'yes', 'on'].includes(value.toLowerCase());
  }

  async approvePublic(token: string, requestMeta: PublicRequestMeta) {
    return this.transitionPublic(token, 'approve', 'approved', requestMeta);
  }

  async declinePublic(token: string, requestMeta: PublicRequestMeta) {
    return this.transitionPublic(token, 'decline', 'declined', requestMeta);
  }

  async signPublic(
    token: string,
    payload: PublicSignEstimateDto,
    requestMeta: PublicRequestMeta,
  ) {
    const grant = await this.accessGrants.findValidGrantByToken(token);
    this.accessGrants.assertPermission(grant, 'sign');
    await this.accessGrants.touchAccess(grant._id);

    const doc = await this.loadDocumentForGrant(grant);
    this.assertFrozenBinding(doc);

    if (doc.status !== 'pending' && doc.status !== 'approved') {
      throw new ConflictException({
        code: 'INCOMPATIBLE_TERMINAL_STATE',
        message: `Cannot sign estimate in status '${doc.status}'.`,
      });
    }

    const signerName = payload.signer_name.trim();
    if (!signerName) {
      throw new BadRequestException('signer_name is required');
    }

    const existing = await this.signatureEvidenceModel
      .findOne({
        organization_id: grant.organization_id,
        document_id: doc._id,
        document_version: doc.frozen_revision_number!,
        access_grant_id: grant._id,
      })
      .exec();

    if (existing) {
      return {
        renderer: this.toRenderer(doc, existing),
        status: doc.status,
        signed: true,
      };
    }

    try {
      const evidence = await this.signatureEvidenceModel.create({
        organization_id: grant.organization_id,
        document_id: doc._id,
        document_version: doc.frozen_revision_number!,
        document_hash: doc.frozen_hash!,
        access_grant_id: grant._id,
        signer_name: signerName,
        signature_asset_id: null,
        signed_at: new Date(),
        ip_address: requestMeta.ipAddress,
        user_agent: requestMeta.userAgent,
      });

      await this.appendPublicEvent({
        organizationId: String(grant.organization_id),
        documentId: doc._id,
        actorUserId: null,
        publicGrantId: grant._id,
        action: 'sign',
        oldStatus: doc.status,
        newStatus: doc.status,
        metadata: {
          document_version: doc.frozen_revision_number,
          document_hash: doc.frozen_hash,
          evidence_kind: 'typed_name',
        },
      });

      return {
        renderer: this.toRenderer(doc, evidence),
        status: doc.status,
        signed: true,
      };
    } catch (error) {
      if (this.isDuplicateKey(error)) {
        const again = await this.signatureEvidenceModel
          .findOne({
            organization_id: grant.organization_id,
            document_id: doc._id,
            document_version: doc.frozen_revision_number!,
            access_grant_id: grant._id,
          })
          .exec();
        if (again) {
          return {
            renderer: this.toRenderer(doc, again),
            status: doc.status,
            signed: true,
          };
        }
      }
      throw error;
    }
  }

  private async transitionPublic(
    token: string,
    permission: 'approve' | 'decline',
    nextStatus: 'approved' | 'declined',
    requestMeta: PublicRequestMeta,
  ) {
    const grant = await this.accessGrants.findValidGrantByToken(token);
    this.accessGrants.assertPermission(grant, permission);
    await this.accessGrants.touchAccess(grant._id);

    const doc = await this.loadDocumentForGrant(grant);
    this.assertFrozenBinding(doc);

    if (doc.status === nextStatus) {
      const signature = await this.findLatestSignature(
        String(grant.organization_id),
        String(doc._id),
      );
      return {
        renderer: this.toRenderer(doc, signature),
        status: doc.status,
      };
    }

    if (doc.status !== 'pending') {
      throw new ConflictException({
        code: 'INCOMPATIBLE_TERMINAL_STATE',
        message: `Cannot ${permission} estimate in status '${doc.status}'.`,
      });
    }

    const updated = await this.documentModel
      .findOneAndUpdate(
        withOrganizationScope(String(grant.organization_id), {
          _id: doc._id,
          status: 'pending',
          frozen_hash: doc.frozen_hash,
          frozen_revision_number: doc.frozen_revision_number,
        }),
        {
          $set: { status: nextStatus },
          $inc: { version: 1 },
        },
        { returnDocument: 'after' },
      )
      .exec();

    if (!updated) {
      const current = await this.loadDocumentForGrant(grant);
      if (current.status === nextStatus) {
        const signature = await this.findLatestSignature(
          String(grant.organization_id),
          String(current._id),
        );
        return {
          renderer: this.toRenderer(current, signature),
          status: current.status,
        };
      }
      throw new ConflictException({
        code: 'INCOMPATIBLE_TERMINAL_STATE',
        message: `Cannot ${permission} estimate in status '${current.status}'.`,
      });
    }

    await this.appendPublicEvent({
      organizationId: String(grant.organization_id),
      documentId: updated._id,
      actorUserId: null,
      publicGrantId: grant._id,
      action: permission,
      oldStatus: 'pending',
      newStatus: nextStatus,
      metadata: {
        document_version: updated.frozen_revision_number,
        document_hash: updated.frozen_hash,
        ip_address: requestMeta.ipAddress,
        user_agent: requestMeta.userAgent,
      },
    });

    const signature = await this.findLatestSignature(
      String(grant.organization_id),
      String(updated._id),
    );
    return {
      renderer: this.toRenderer(updated, signature),
      status: updated.status,
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

  private async requireEstimateEntity(id: string, organizationId: string) {
    const doc = await this.documentsService.findDocumentEntity(
      id,
      organizationId,
    );
    if (doc.type !== 'estimate') {
      throw new NotFoundException('Estimate document not found');
    }
    return doc;
  }

  private async loadDocumentForGrant(grant: {
    organization_id: Types.ObjectId;
    document_id: Types.ObjectId;
  }) {
    const doc = await this.documentModel
      .findOne(
        withOrganizationScope(String(grant.organization_id), {
          _id: grant.document_id,
          type: 'estimate' as const,
        }),
      )
      .exec();
    if (!doc) {
      throw new UnauthorizedException('Invalid or expired link');
    }
    return doc;
  }

  private async loadInvoiceDocumentForGrant(grant: {
    organization_id: Types.ObjectId;
    document_id: Types.ObjectId;
  }) {
    const doc = await this.documentModel
      .findOne(
        withOrganizationScope(String(grant.organization_id), {
          _id: grant.document_id,
          type: 'invoice' as const,
        }),
      )
      .exec();
    if (!doc) {
      throw new UnauthorizedException('Invalid or expired link');
    }
    return doc;
  }

  private assertFrozenBinding(doc: OrgDocumentDocument) {
    if (!doc.frozen_hash || !doc.frozen_revision_number) {
      throw new ConflictException({
        code: 'ESTIMATE_NOT_FROZEN',
        message: 'Document revision is not frozen for public acceptance.',
      });
    }
  }

  private async findLatestSignature(
    organizationId: string,
    documentId: string,
  ) {
    return this.signatureEvidenceModel
      .findOne(
        withOrganizationScope(organizationId, {
          document_id: asObjectId(documentId, 'document id'),
        }),
      )
      .sort({ signed_at: -1 })
      .exec();
  }

  private buildPublicUrl(token: string) {
    const base =
      this.configService.get<string>('PUBLIC_APP_BASE_URL') ??
      this.configService.get<string>('FRONTEND_ORIGIN');
    if (!base) {
      throw new BadRequestException(
        'PUBLIC_APP_BASE_URL or FRONTEND_ORIGIN is required to build public estimate links',
      );
    }
    return `${base.replace(/\/$/, '')}/view/estimate/${token}`;
  }

  private async appendPublicEvent(input: {
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

  private isDuplicateKey(error: unknown) {
    return (
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      (error as { code?: number }).code === 11000
    );
  }
}
