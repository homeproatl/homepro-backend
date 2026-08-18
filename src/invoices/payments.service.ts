import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import { ClientSession, Connection, Model, Types } from 'mongoose';
import { AuditLog } from '../audit-logs/schemas/audit-log.schema';
import { UserRole } from '../common/enums/user-role.enum';
import type { AuthActor } from '../common/types/auth-actor';
import { asObjectId } from '../common/utils/object-id';
import { withOrganizationScope } from '../common/utils/organization-scope';
import {
  OrgDocument,
  OrgDocumentDocument,
} from '../documents/schemas/document.schema';
import { CreateManualAdjustmentDto } from './dto/create-manual-adjustment.dto';
import { CreateManualPaymentDto } from './dto/create-manual-payment.dto';
import { CreateManualRefundDto } from './dto/create-manual-refund.dto';
import {
  PaymentLedgerEntry,
  PaymentLedgerEntryDocument,
} from './schemas/payment-ledger-entry.schema';
import { Payment, PaymentDocument } from './schemas/payment.schema';

@Injectable()
export class PaymentsService {
  private readonly logger = new Logger(PaymentsService.name);

  constructor(
    @InjectModel(Payment.name)
    private readonly paymentModel: Model<PaymentDocument>,
    @InjectModel(PaymentLedgerEntry.name)
    private readonly ledgerModel: Model<PaymentLedgerEntryDocument>,
    @InjectModel(OrgDocument.name)
    private readonly documentModel: Model<OrgDocumentDocument>,
    @InjectModel(AuditLog.name)
    private readonly auditLogModel: Model<AuditLog>,
    @InjectConnection()
    private readonly connection: Connection,
  ) {}

  async recordManualPayment(
    documentId: string,
    dto: CreateManualPaymentDto,
    actor: AuthActor,
  ) {
    const docObjectId = asObjectId(documentId, 'document id');
    const amountMinor = dto.amount_minor;
    if (!amountMinor || amountMinor <= 0) {
      throw new BadRequestException('Payment amount must be greater than zero');
    }

    const idempotencyKey = this.requireIdempotencyKey(
      dto.idempotency_key,
      'manual payment',
    );

    const existingLedger = await this.findLedgerByIdempotency(
      actor.organization_id,
      idempotencyKey,
    );
    if (existingLedger) {
      const existingPayment = await this.paymentModel
        .findById(existingLedger.payment_id)
        .exec();
      const doc = await this.requireInvoice(docObjectId, actor.organization_id);
      return {
        payment: existingPayment,
        ledger_entry: existingLedger,
        document: doc,
      };
    }

    const effectiveAt = this.parseRequiredEffectiveAt(
      dto.effective_at,
      'manual payment',
    );
    const reference = dto.reference?.trim() || null;
    const note = dto.note?.trim() || null;

    const session = await this.connection.startSession();
    let resultPayment: PaymentDocument;
    let resultLedger: PaymentLedgerEntryDocument;
    let updatedDoc: OrgDocumentDocument;

    try {
      await session.withTransaction(async () => {
        const doc = await this.lockInvoice(
          docObjectId,
          actor.organization_id,
          session,
        );
        this.assertNotVoid(doc);

        const activeOnlinePayment = await this.paymentModel
          .findOne(
            {
              organization_id: doc.organization_id,
              document_id: doc._id,
              provider: 'stripe',
              status: { $in: ['created', 'checkout_open', 'processing'] },
            },
            null,
            { session },
          )
          .lean()
          .exec();
        if (activeOnlinePayment) {
          throw new ConflictException(
            activeOnlinePayment.status === 'processing'
              ? 'A payment is already processing for this invoice.'
              : 'An online payment session is still open for this invoice.',
          );
        }

        if (amountMinor > doc.balance_due_minor) {
          throw new BadRequestException(
            `Payment amount ($${(amountMinor / 100).toFixed(2)}) exceeds balance due ($${(doc.balance_due_minor / 100).toFixed(2)})`,
          );
        }

        // Re-check idempotency inside the transaction.
        const raced = await this.ledgerModel
          .findOne(
            withOrganizationScope(actor.organization_id, {
              idempotency_key: idempotencyKey,
            }),
            null,
            { session },
          )
          .exec();
        if (raced) {
          const existingPayment = await this.paymentModel
            .findById(raced.payment_id, null, { session })
            .exec();
          resultPayment = existingPayment!;
          resultLedger = raced;
          updatedDoc = doc;
          return;
        }

        const [payment] = await this.paymentModel.create(
          [
            {
              organization_id: asObjectId(actor.organization_id, 'org id'),
              document_id: doc._id,
              client_id: doc.client_id,
              provider: 'manual',
              amount_minor: amountMinor,
              currency: 'usd',
              status: 'succeeded',
              method: dto.method,
              purpose: dto.purpose ?? 'invoice_balance',
              reference,
              note,
              effective_at: effectiveAt,
              created_by_user_id: actor.user_id
                ? asObjectId(actor.user_id, 'user id')
                : null,
            },
          ],
          { session },
        );
        resultPayment = payment;

        const [ledger] = await this.ledgerModel.create(
          [
            {
              organization_id: asObjectId(actor.organization_id, 'org id'),
              document_id: doc._id,
              payment_id: payment._id,
              entry_type: 'payment',
              amount_minor: amountMinor,
              currency: 'usd',
              provider_object_id: null,
              idempotency_key: idempotencyKey,
              effective_at: effectiveAt,
              created_by_user_id: actor.user_id
                ? asObjectId(actor.user_id, 'user id')
                : null,
            },
          ],
          { session },
        );
        resultLedger = ledger;

        updatedDoc = await this.applyLedgerTotals(doc, session);

        await this.auditLogModel.create(
          [
            {
              organization_id: asObjectId(actor.organization_id, 'org id'),
              actor_user_id: actor.user_id
                ? asObjectId(actor.user_id, 'user id')
                : null,
              action: 'invoice.payment.recorded',
              entity_type: 'invoice',
              entity_id: String(doc._id),
              before_json: null,
              after_json: {
                payment_id: String(payment._id),
                ledger_id: String(ledger._id),
                amount_minor: amountMinor,
                method: dto.method,
                reference,
              },
            },
          ],
          { session },
        );
      });
    } finally {
      await session.endSession();
    }

    return {
      payment: resultPayment!,
      ledger_entry: resultLedger!,
      document: updatedDoc!,
    };
  }

  async recordManualRefund(
    documentId: string,
    dto: CreateManualRefundDto,
    actor: AuthActor,
  ) {
    const docObjectId = asObjectId(documentId, 'document id');
    const paymentObjectId = asObjectId(dto.payment_id, 'payment id');

    const amountMinor = dto.amount_minor;
    if (!amountMinor || amountMinor <= 0) {
      throw new BadRequestException('Refund amount must be greater than zero');
    }

    const idempotencyKey = this.requireIdempotencyKey(
      dto.idempotency_key,
      'manual refund',
    );

    const existingLedger = await this.findLedgerByIdempotency(
      actor.organization_id,
      idempotencyKey,
    );
    if (existingLedger) {
      const payment = await this.paymentModel
        .findById(existingLedger.payment_id)
        .exec();
      const doc = await this.requireInvoice(docObjectId, actor.organization_id);
      return {
        ledger_entry: existingLedger,
        payment,
        document: doc,
      };
    }

    const effectiveAt = this.parseRequiredEffectiveAt(
      dto.effective_at,
      'manual refund',
    );

    const session = await this.connection.startSession();
    let resultLedger: PaymentLedgerEntryDocument;
    let resultPayment: PaymentDocument;
    let updatedDoc: OrgDocumentDocument;

    try {
      await session.withTransaction(async () => {
        const doc = await this.lockInvoice(
          docObjectId,
          actor.organization_id,
          session,
        );
        this.assertNotVoid(doc);

        const payment = await this.paymentModel
          .findOne(
            withOrganizationScope(actor.organization_id, {
              _id: paymentObjectId,
              document_id: docObjectId,
            }),
            null,
            { session },
          )
          .exec();

        if (!payment) {
          throw new NotFoundException(
            'Payment record not found for this invoice',
          );
        }

        const existingRefundEntries = await this.ledgerModel
          .find(
            {
              organization_id: asObjectId(actor.organization_id, 'org id'),
              payment_id: payment._id,
              entry_type: 'refund',
            },
            null,
            { session },
          )
          .exec();

        const previousRefundTotal = existingRefundEntries.reduce(
          (acc, entry) => acc + Math.abs(entry.amount_minor),
          0,
        );

        if (previousRefundTotal + amountMinor > payment.amount_minor) {
          throw new BadRequestException(
            `Refund amount ($${(amountMinor / 100).toFixed(2)}) exceeds remaining refundable amount ($${((payment.amount_minor - previousRefundTotal) / 100).toFixed(2)}) on this payment`,
          );
        }

        const raced = await this.ledgerModel
          .findOne(
            withOrganizationScope(actor.organization_id, {
              idempotency_key: idempotencyKey,
            }),
            null,
            { session },
          )
          .exec();
        if (raced) {
          resultLedger = raced;
          resultPayment = payment;
          updatedDoc = doc;
          return;
        }

        const [ledger] = await this.ledgerModel.create(
          [
            {
              organization_id: asObjectId(actor.organization_id, 'org id'),
              document_id: doc._id,
              payment_id: payment._id,
              entry_type: 'refund',
              amount_minor: -amountMinor,
              currency: 'usd',
              provider_object_id: null,
              idempotency_key: idempotencyKey,
              effective_at: effectiveAt,
              created_by_user_id: actor.user_id
                ? asObjectId(actor.user_id, 'user id')
                : null,
            },
          ],
          { session },
        );
        resultLedger = ledger;

        const newRefundTotal = previousRefundTotal + amountMinor;
        if (newRefundTotal >= payment.amount_minor) {
          payment.status = 'refunded';
        } else {
          payment.status = 'partially_refunded';
        }
        await payment.save({ session });
        resultPayment = payment;

        updatedDoc = await this.applyLedgerTotals(doc, session);

        await this.auditLogModel.create(
          [
            {
              organization_id: asObjectId(actor.organization_id, 'org id'),
              actor_user_id: actor.user_id
                ? asObjectId(actor.user_id, 'user id')
                : null,
              action: 'invoice.refund.recorded',
              entity_type: 'invoice',
              entity_id: String(doc._id),
              before_json: null,
              after_json: {
                payment_id: String(payment._id),
                ledger_id: String(ledger._id),
                amount_minor: amountMinor,
                reason: dto.reason,
                reference: dto.reference ?? null,
              },
            },
          ],
          { session },
        );
      });
    } finally {
      await session.endSession();
    }

    return {
      ledger_entry: resultLedger!,
      payment: resultPayment!,
      document: updatedDoc!,
    };
  }

  async recordManualAdjustment(
    documentId: string,
    dto: CreateManualAdjustmentDto,
    actor: AuthActor,
  ) {
    if (actor.role !== UserRole.ADMIN) {
      throw new ForbiddenException(
        'Only administrators can post manual ledger adjustments',
      );
    }

    if (!dto.reason || !dto.reason.trim()) {
      throw new BadRequestException(
        'A reason is required for manual adjustments',
      );
    }

    if (!dto.amount_minor || dto.amount_minor === 0) {
      throw new BadRequestException('Adjustment amount must be non-zero');
    }

    const docObjectId = asObjectId(documentId, 'document id');
    const idempotencyKey = this.requireIdempotencyKey(
      dto.idempotency_key,
      'manual adjustment',
    );

    const existingLedger = await this.findLedgerByIdempotency(
      actor.organization_id,
      idempotencyKey,
    );
    if (existingLedger) {
      const doc = await this.requireInvoice(docObjectId, actor.organization_id);
      return {
        ledger_entry: existingLedger,
        document: doc,
      };
    }

    const effectiveAt = this.parseRequiredEffectiveAt(
      dto.effective_at,
      'manual adjustment',
    );
    const adjustmentNote = dto.note?.trim() || null;

    const session = await this.connection.startSession();
    let resultLedger: PaymentLedgerEntryDocument;
    let updatedDoc: OrgDocumentDocument;

    try {
      await session.withTransaction(async () => {
        const doc = await this.lockInvoice(
          docObjectId,
          actor.organization_id,
          session,
        );
        this.assertNotVoid(doc);

        const raced = await this.ledgerModel
          .findOne(
            withOrganizationScope(actor.organization_id, {
              idempotency_key: idempotencyKey,
            }),
            null,
            { session },
          )
          .exec();
        if (raced) {
          resultLedger = raced;
          updatedDoc = doc;
          return;
        }

        // Dummy payment reference for adjustment entry (ledger requires payment_id).
        const [adjPayment] = await this.paymentModel.create(
          [
            {
              organization_id: asObjectId(actor.organization_id, 'org id'),
              document_id: doc._id,
              client_id: doc.client_id,
              provider: 'manual',
              amount_minor: Math.abs(dto.amount_minor),
              currency: 'usd',
              status: 'succeeded',
              method: 'other',
              purpose: 'other',
              reference: `Adjustment: ${dto.reason.trim()}`,
              note: adjustmentNote,
              effective_at: effectiveAt,
              created_by_user_id: actor.user_id
                ? asObjectId(actor.user_id, 'user id')
                : null,
            },
          ],
          { session },
        );

        const [ledger] = await this.ledgerModel.create(
          [
            {
              organization_id: asObjectId(actor.organization_id, 'org id'),
              document_id: doc._id,
              payment_id: adjPayment._id,
              entry_type: 'manual_adjustment',
              amount_minor: dto.amount_minor,
              currency: 'usd',
              provider_object_id: null,
              idempotency_key: idempotencyKey,
              effective_at: effectiveAt,
              created_by_user_id: actor.user_id
                ? asObjectId(actor.user_id, 'user id')
                : null,
            },
          ],
          { session },
        );
        resultLedger = ledger;

        updatedDoc = await this.applyLedgerTotals(doc, session);

        await this.auditLogModel.create(
          [
            {
              organization_id: asObjectId(actor.organization_id, 'org id'),
              actor_user_id: actor.user_id
                ? asObjectId(actor.user_id, 'user id')
                : null,
              action: 'invoice.adjustment.recorded',
              entity_type: 'invoice',
              entity_id: String(doc._id),
              before_json: null,
              after_json: {
                ledger_id: String(ledger._id),
                amount_minor: dto.amount_minor,
                reason: dto.reason.trim(),
                entry_type: 'manual_adjustment',
              },
            },
          ],
          { session },
        );
      });
    } finally {
      await session.endSession();
    }

    return {
      ledger_entry: resultLedger!,
      document: updatedDoc!,
    };
  }

  async getPaymentsForDocument(documentId: string, organizationId: string) {
    const docObjectId = asObjectId(documentId, 'document id');
    const payments = await this.paymentModel
      .find({
        organization_id: asObjectId(organizationId, 'org id'),
        document_id: docObjectId,
      })
      .sort({ effective_at: -1, created_at: -1 })
      .exec();

    const ledgerEntries = await this.ledgerModel
      .find({
        organization_id: asObjectId(organizationId, 'org id'),
        document_id: docObjectId,
      })
      .sort({ effective_at: -1, created_at: -1 })
      .exec();

    return {
      payments,
      ledger_entries: ledgerEntries,
    };
  }

  async recomputeInvoiceTotals(documentId: string, organizationId: string) {
    const docObjectId = asObjectId(documentId, 'document id');
    const session = await this.connection.startSession();
    let updatedDoc: OrgDocumentDocument;

    try {
      await session.withTransaction(async () => {
        const doc = await this.lockInvoice(
          docObjectId,
          organizationId,
          session,
        );
        updatedDoc = await this.applyLedgerTotals(doc, session);
      });
    } finally {
      await session.endSession();
    }

    return updatedDoc!;
  }

  private requireIdempotencyKey(
    key: string | undefined,
    label: string,
  ): string {
    const trimmed = key?.trim();
    if (!trimmed) {
      throw new BadRequestException(
        `idempotency_key is required for ${label} to support safe retries`,
      );
    }
    return trimmed;
  }

  private parseRequiredEffectiveAt(
    value: string | undefined,
    label: string,
  ): Date {
    const trimmed = value?.trim();
    if (!trimmed) {
      throw new BadRequestException(`effective_at is required for ${label}`);
    }

    const parsed = new Date(trimmed);
    if (Number.isNaN(parsed.getTime())) {
      throw new BadRequestException(`effective_at is invalid for ${label}`);
    }
    return parsed;
  }

  private assertNotVoid(doc: OrgDocumentDocument) {
    if (doc.status === 'void') {
      throw new ConflictException(
        'Cannot record ledger effects on a voided invoice',
      );
    }
  }

  private async requireInvoice(
    docObjectId: Types.ObjectId,
    organizationId: string,
  ) {
    const doc = await this.documentModel
      .findOne(
        withOrganizationScope(organizationId, {
          _id: docObjectId,
        }),
      )
      .exec();
    if (!doc || doc.type !== 'invoice') {
      throw new NotFoundException('Invoice not found');
    }
    return doc;
  }

  private async lockInvoice(
    docObjectId: Types.ObjectId,
    organizationId: string,
    session: ClientSession,
  ) {
    const doc = await this.documentModel
      .findOne(
        withOrganizationScope(organizationId, {
          _id: docObjectId,
          type: 'invoice',
        }),
        null,
        { session },
      )
      .exec();
    if (!doc) {
      throw new NotFoundException('Invoice not found');
    }
    return doc;
  }

  private findLedgerByIdempotency(organizationId: string, key: string) {
    return this.ledgerModel
      .findOne(
        withOrganizationScope(organizationId, {
          idempotency_key: key,
        }),
      )
      .exec();
  }

  private async applyLedgerTotals(
    doc: OrgDocumentDocument,
    session: ClientSession,
  ) {
    const { amountPaid, amountRefunded, amountDisputed, balanceDue } =
      await this.calculateTotalsFromLedger(doc._id, doc.total_minor, session);

    const changed =
      doc.amount_paid_minor !== amountPaid ||
      doc.amount_refunded_minor !== amountRefunded ||
      doc.amount_disputed_minor !== amountDisputed ||
      doc.balance_due_minor !== balanceDue;

    if (!changed) {
      return doc;
    }

    doc.amount_paid_minor = amountPaid;
    doc.amount_refunded_minor = amountRefunded;
    doc.amount_disputed_minor = amountDisputed;
    doc.balance_due_minor = balanceDue;
    doc.version += 1;
    await doc.save({ session });
    return doc;
  }

  private async calculateTotalsFromLedger(
    documentId: Types.ObjectId,
    totalMinor: number,
    session?: ClientSession,
  ) {
    const ledgerEntries = await this.ledgerModel
      .find({ document_id: documentId }, null, { session })
      .exec();

    let amountPaid = 0;
    let amountRefunded = 0;
    let disputeHolds = 0;
    let disputeReversals = 0;

    for (const entry of ledgerEntries) {
      if (
        entry.entry_type === 'payment' ||
        (entry.entry_type === 'manual_adjustment' && entry.amount_minor > 0)
      ) {
        amountPaid += entry.amount_minor;
      } else if (
        entry.entry_type === 'refund' ||
        (entry.entry_type === 'manual_adjustment' && entry.amount_minor < 0)
      ) {
        amountRefunded += Math.abs(entry.amount_minor);
      } else if (entry.entry_type === 'dispute_hold') {
        disputeHolds += Math.abs(entry.amount_minor);
      } else if (entry.entry_type === 'dispute_reversal') {
        disputeReversals += Math.abs(entry.amount_minor);
      }
    }

    amountRefunded = Math.min(amountRefunded, amountPaid);
    const amountDisputed = Math.min(
      Math.max(0, disputeHolds - disputeReversals),
      Math.max(0, amountPaid - amountRefunded),
    );
    const netPaid = amountPaid - amountRefunded - amountDisputed;
    const balanceDue = Math.min(totalMinor, Math.max(0, totalMinor - netPaid));

    return {
      amountPaid,
      amountRefunded,
      amountDisputed,
      balanceDue,
    };
  }
}
