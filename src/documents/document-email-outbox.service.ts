import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Resend } from 'resend';
import { asObjectId } from '../common/utils/object-id';
import { withOrganizationScope } from '../common/utils/organization-scope';
import {
  decryptBytes,
  decryptPublicPayload,
  encryptBytes,
  encryptPublicPayload,
} from './document-token.crypto';
import {
  renderEstimateEmailBodies,
  renderInvoiceEmailBodies,
} from './document-pdf-template';
import {
  DocumentEmailOutbox,
  DocumentEmailOutboxDocument,
} from './schemas/document-email-outbox.schema';
import { OrgDocument, OrgDocumentDocument } from './schemas/document.schema';

const MAX_ATTEMPTS = 8;
const BASE_RETRY_MS = 30_000;

@Injectable()
export class DocumentEmailOutboxService {
  private readonly logger = new Logger(DocumentEmailOutboxService.name);
  private resendClient: Resend | null = null;

  constructor(
    @InjectModel(DocumentEmailOutbox.name)
    private readonly outboxModel: Model<DocumentEmailOutboxDocument>,
    @InjectModel(OrgDocument.name)
    private readonly documentModel: Model<OrgDocumentDocument>,
    private readonly configService: ConfigService,
  ) {}

  async enqueue(input: {
    organizationId: string;
    documentId: string;
    documentVersion: number;
    documentHash: string;
    recipientEmail: string;
    templateKey: string;
    idempotencyKey: string;
    token: string;
    publicUrl: string;
    emailSnapshot: {
      company_name: string;
      client_display_name: string;
      document_number: string;
      estimate_number?: string;
      total_minor: number;
      subject?: string | null;
      message?: string | null;
    };
    /** Optional PDF bytes for invoice attachment. */
    pdfBuffer?: Buffer;
  }): Promise<{ row: DocumentEmailOutboxDocument; created: boolean }> {
    const encryptionKey = this.requireOutboxKey();
    const encrypted = encryptPublicPayload(
      { token: input.token, public_url: input.publicUrl },
      encryptionKey,
    );
    const encryptedPdf = input.pdfBuffer
      ? encryptBytes(input.pdfBuffer, encryptionKey)
      : null;

    try {
      const created = await this.outboxModel.create({
        organization_id: asObjectId(input.organizationId, 'organization id'),
        document_id: asObjectId(input.documentId, 'document id'),
        document_version: input.documentVersion,
        document_hash: input.documentHash,
        recipient_email: input.recipientEmail.trim().toLowerCase(),
        template_key: input.templateKey,
        email_snapshot: input.emailSnapshot,
        idempotency_key: input.idempotencyKey,
        status: 'pending',
        attempt_count: 0,
        lease_until: null,
        next_attempt_at: new Date(),
        provider_message_id: null,
        last_error: null,
        encrypted_public_payload: encrypted,
        encrypted_pdf_payload: encryptedPdf,
        sent_at: null,
      });
      return { row: created, created: true };
    } catch (error) {
      if (this.isDuplicateKey(error)) {
        const existing = await this.outboxModel
          .findOne({ idempotency_key: input.idempotencyKey })
          .exec();
        if (existing) {
          return { row: existing, created: false };
        }
      }
      throw error;
    }
  }

  /**
   * Safe dispatch rows for admin history (no encrypted payload/token).
   */
  listSafeForDocument(organizationId: string, documentId: string) {
    return this.outboxModel
      .find(
        withOrganizationScope(organizationId, {
          document_id: asObjectId(documentId, 'document id'),
        }),
      )
      .select('-encrypted_public_payload -encrypted_pdf_payload')
      .sort({ created_at: -1 })
      .exec();
  }

  /**
   * Claim and process due outbox rows. Safe to call repeatedly / on restart.
   */
  async processDue(limit = 10): Promise<number> {
    let processed = 0;
    for (let i = 0; i < limit; i += 1) {
      const claimed = await this.claimNext();
      if (!claimed) {
        break;
      }
      await this.processClaimed(claimed);
      processed += 1;
    }
    return processed;
  }

  findByIdempotencyKey(idempotencyKey: string) {
    return this.outboxModel.findOne({ idempotency_key: idempotencyKey }).exec();
  }

  /**
   * Decrypt the public payload for grant recovery after a crash between
   * enqueue and installGrant. Returns null when the payload was erased.
   */
  peekPublicPayload(row: DocumentEmailOutboxDocument): {
    token: string;
    public_url: string;
  } | null {
    if (!row.encrypted_public_payload) {
      return null;
    }
    return decryptPublicPayload(
      row.encrypted_public_payload,
      this.requireOutboxKey(),
    );
  }

  async retryFailed(outboxId: string, organizationId: string) {
    return this.outboxModel
      .findOneAndUpdate(
        {
          _id: asObjectId(outboxId, 'outbox id'),
          organization_id: asObjectId(organizationId, 'organization id'),
          status: 'failed',
        },
        {
          $set: {
            status: 'pending',
            attempt_count: 0,
            next_attempt_at: new Date(),
            lease_until: null,
            last_error: null,
          },
        },
        { returnDocument: 'after' },
      )
      .exec();
  }

  private async claimNext() {
    const now = new Date();
    return this.outboxModel
      .findOneAndUpdate(
        {
          encrypted_public_payload: { $ne: null },
          attempt_count: { $lt: MAX_ATTEMPTS },
          $or: [
            {
              status: { $in: ['pending', 'failed'] },
              $and: [
                {
                  $or: [
                    { next_attempt_at: null },
                    { next_attempt_at: { $lte: now } },
                  ],
                },
                {
                  $or: [{ lease_until: null }, { lease_until: { $lte: now } }],
                },
              ],
            },
            // Restart-safe: reclaim abandoned processing leases.
            {
              status: 'processing',
              lease_until: { $lte: now },
            },
          ],
        },
        {
          $set: {
            status: 'processing',
            lease_until: new Date(Date.now() + 60_000),
          },
          $inc: { attempt_count: 1 },
        },
        {
          returnDocument: 'after',
          sort: { next_attempt_at: 1, created_at: 1 },
        },
      )
      .exec();
  }

  private async processClaimed(row: DocumentEmailOutboxDocument) {
    try {
      const transport = (
        this.configService.get<string>('INVOICE_EMAIL_TRANSPORT') ?? 'LOG'
      ).toUpperCase();
      const from = this.configService.get<string>('INVOICE_EMAIL_FROM');
      const encryptionKey = this.requireOutboxKey();
      if (!row.encrypted_public_payload) {
        throw new Error('Missing encrypted public payload');
      }
      const payload = decryptPublicPayload(
        row.encrypted_public_payload,
        encryptionKey,
      );

      const snapshot = row.email_snapshot;
      const documentNumber =
        snapshot.document_number || snapshot.estimate_number || 'Document';
      const rendererModel = {
        document_type:
          row.template_key === 'invoice.send'
            ? ('invoice' as const)
            : ('estimate' as const),
        number: documentNumber,
        po_number: null,
        status: 'pending',
        issue_date: null,
        expiration_date: null,
        due_date: null,
        job_name: null,
        service_address: null,
        company: {
          display_name: snapshot.company_name,
          legal_name: null,
          phone: null,
          email: null,
          website: null,
          address: null,
          license_number: null,
        },
        client: {
          display_name: snapshot.client_display_name,
          company_name: null,
          email: null,
          phone: null,
          billing_address: null,
        },
        line_items: [],
        document_photos: [],
        attachments: [],
        customer_notes: null,
        contract_body: null,
        show_client_signature: false,
        show_company_signature: false,
        client_signature: null,
        totals: {
          subtotal_minor: snapshot.total_minor,
          markup_total_minor: 0,
          discount_total_minor: 0,
          tax_total_minor: 0,
          deposit_requested_minor: 0,
          total_minor: snapshot.total_minor,
          payments_applied_minor: 0,
          amount_due_minor: snapshot.total_minor,
        },
        frozen_revision_number: row.document_version,
        currency: 'usd' as const,
      };
      const bodies =
        row.template_key === 'invoice.send'
          ? renderInvoiceEmailBodies({
              model: rendererModel,
              publicUrl: payload.public_url,
              companyName: snapshot.company_name,
              subject: snapshot.subject ?? null,
              message: snapshot.message ?? null,
            })
          : renderEstimateEmailBodies({
              model: rendererModel,
              publicUrl: payload.public_url,
              companyName: snapshot.company_name,
              subject: snapshot.subject ?? null,
              message: snapshot.message ?? null,
            });

      const pdfAttachment =
        row.encrypted_pdf_payload != null
          ? decryptBytes(row.encrypted_pdf_payload, encryptionKey)
          : null;

      let providerMessageId: string | null = null;
      if (transport === 'DISABLED') {
        providerMessageId = `disabled-${String(row._id)}`;
      } else if (transport === 'LOG') {
        this.logger.log(
          `Email outbox LOG mode → ${row.recipient_email} (public URL redacted${
            pdfAttachment ? `, pdfBytes=${pdfAttachment.length}` : ''
          })`,
        );
        providerMessageId = `log-${String(row._id)}`;
      } else if (transport === 'RESEND') {
        if (!from) {
          throw new Error('INVOICE_EMAIL_FROM is required for RESEND');
        }
        const client = this.getResendClient();
        const result = await client.emails.send(
          {
            from,
            to: [row.recipient_email],
            subject: bodies.subject,
            text: bodies.text,
            html: bodies.html,
            attachments: pdfAttachment
              ? [
                  {
                    filename: `${documentNumber}.pdf`,
                    content: pdfAttachment,
                    contentType: 'application/pdf',
                  },
                ]
              : undefined,
          },
          {
            idempotencyKey: (row.idempotency_key ?? String(row._id)).slice(
              0,
              256,
            ),
          },
        );
        if (result.error) {
          const message =
            typeof result.error === 'object' &&
            result.error !== null &&
            'message' in result.error
              ? String((result.error as { message: string }).message)
              : 'Resend send failed';
          throw new Error(message);
        }
        providerMessageId =
          result.data && typeof result.data === 'object' && 'id' in result.data
            ? String((result.data as { id: string }).id)
            : null;
      } else {
        throw new Error(`Unsupported email transport: ${transport}`);
      }

      await this.outboxModel
        .updateOne(
          { _id: row._id },
          {
            $set: {
              status: 'sent',
              provider_message_id: providerMessageId,
              sent_at: new Date(),
              lease_until: null,
              last_error: null,
              encrypted_public_payload: null,
              encrypted_pdf_payload: null,
            },
          },
        )
        .exec();

      await this.documentModel
        .updateOne(
          { _id: row.document_id, organization_id: row.organization_id },
          { $set: { email_state: 'sent' } },
        )
        .exec();
    } catch (error) {
      const message =
        error instanceof Error ? error.message.slice(0, 500) : 'Send failed';
      const attempts = row.attempt_count;
      const terminal = attempts >= MAX_ATTEMPTS;
      const delay = BASE_RETRY_MS * 2 ** Math.min(attempts - 1, 6);
      await this.outboxModel
        .updateOne(
          { _id: row._id },
          {
            $set: {
              status: terminal ? 'failed' : 'pending',
              last_error: message,
              lease_until: null,
              next_attempt_at: new Date(Date.now() + delay),
            },
          },
        )
        .exec();
      if (terminal) {
        await this.documentModel
          .updateOne(
            { _id: row.document_id, organization_id: row.organization_id },
            { $set: { email_state: 'delivery_failed' } },
          )
          .exec();
      }
      this.logger.warn(`Outbox send failed for ${String(row._id)}: ${message}`);
    }
  }

  private getResendClient() {
    if (!this.resendClient) {
      const apiKey = this.configService.getOrThrow<string>(
        'INVOICE_EMAIL_RESEND_API_KEY',
      );
      this.resendClient = new Resend(apiKey);
    }
    return this.resendClient;
  }

  private requireOutboxKey() {
    const key = this.configService.get<string>('OUTBOX_ENCRYPTION_KEY');
    if (!key || key.trim().length < 16) {
      throw new Error('OUTBOX_ENCRYPTION_KEY is required for document email');
    }
    return key;
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
