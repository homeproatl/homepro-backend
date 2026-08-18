import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import { Connection, Model, Types } from 'mongoose';
import Stripe from 'stripe';
import { Client, ClientDocument } from '../clients/schemas/client.schema';
import type { AuthActor } from '../common/types/auth-actor';
import { asObjectId } from '../common/utils/object-id';
import { withOrganizationScope } from '../common/utils/organization-scope';
import { DocumentAccessGrantsService } from '../documents/document-access-grants.service';
import {
  OrgDocument,
  OrgDocumentDocument,
} from '../documents/schemas/document.schema';
import { PaymentsService } from './payments.service';
import { PaymentNotificationService } from './payment-notification.service';
import {
  PaymentCustomerProfile,
  PaymentCustomerProfileDocument,
} from './schemas/payment-customer-profile.schema';
import {
  PaymentLedgerEntry,
  PaymentLedgerEntryDocument,
} from './schemas/payment-ledger-entry.schema';
import {
  Payment,
  PaymentDocument,
  PaymentMethod,
} from './schemas/payment.schema';
import {
  StripeEventInbox,
  StripeEventInboxDocument,
} from './schemas/stripe-event-inbox.schema';

type CheckoutPreference = 'automatic';
type ResolvedStripePaymentMethod = {
  method: PaymentMethod;
  providerType: string;
};
type StripeEventObject =
  | Stripe.Checkout.Session
  | Stripe.PaymentIntent
  | Stripe.Charge
  | Stripe.Dispute;

type RuntimeConfig = {
  enabled: boolean;
  secretKey: string;
  webhookSecret: string;
  publicAppBaseUrl: string;
  currency: 'usd';
  liveModeExpected: boolean | null;
};

const STRIPE_WEBHOOK_LEASE_MS = 5 * 60 * 1000;

@Injectable()
export class StripePaymentsService {
  private readonly logger = new Logger(StripePaymentsService.name);
  private stripeClient: Stripe | null = null;
  private stripeClientKey: string | null = null;

  constructor(
    private readonly configService: ConfigService,
    private readonly accessGrants: DocumentAccessGrantsService,
    private readonly paymentsService: PaymentsService,
    private readonly paymentNotifications: PaymentNotificationService,
    @InjectModel(Payment.name)
    private readonly paymentModel: Model<PaymentDocument>,
    @InjectModel(PaymentLedgerEntry.name)
    private readonly ledgerModel: Model<PaymentLedgerEntryDocument>,
    @InjectModel(OrgDocument.name)
    private readonly documentModel: Model<OrgDocumentDocument>,
    @InjectModel(Client.name)
    private readonly clientModel: Model<ClientDocument>,
    @InjectModel(PaymentCustomerProfile.name)
    private readonly customerProfileModel: Model<PaymentCustomerProfileDocument>,
    @InjectModel(StripeEventInbox.name)
    private readonly stripeEventInboxModel: Model<StripeEventInboxDocument>,
    @InjectConnection()
    private readonly connection: Connection,
  ) {}

  getPublicReadiness(document: OrgDocumentDocument) {
    const runtime = this.getRuntimeConfig(false);
    const permissionsReady = document.type === 'invoice';
    const hasBalance = document.balance_due_minor > 0;
    const clientEmail = document.client_snapshot?.email?.trim() ?? null;
    const canPay =
      permissionsReady &&
      runtime.enabled &&
      document.online_payments_enabled &&
      hasBalance &&
      document.status !== 'void' &&
      Boolean(clientEmail);

    return {
      can_pay: canPay,
      amount_due_minor: document.balance_due_minor,
      currency: runtime.currency,
      disabled_reason: canPay
        ? null
        : this.resolvePublicDisabledReason(document, runtime, clientEmail),
    };
  }

  async createPublicCheckoutSession(token: string) {
    const method: CheckoutPreference = 'automatic';
    const runtime = this.requireRuntime();
    const grant = await this.accessGrants.findValidGrantByToken(token);
    this.accessGrants.assertPermission(grant, 'pay');
    await this.accessGrants.touchAccess(grant._id);

    const document = await this.documentModel
      .findById(grant.document_id)
      .exec();
    if (!document || document.type !== 'invoice') {
      throw new NotFoundException('Invoice not found');
    }

    return this.createCheckoutForInvoice({
      document,
      method,
      runtime,
      token,
      createdByUserId: null,
      source: 'public_invoice',
    });
  }

  async prepareForInvoiceMutation(invoiceId: string, actor: AuthActor) {
    const documentId = asObjectId(invoiceId, 'invoice id');
    const activePayment = await this.paymentModel
      .findOne(
        withOrganizationScope(actor.organization_id, {
          document_id: documentId,
          provider: 'stripe' as const,
          status: {
            $in: [
              'created',
              'checkout_open',
              'processing',
            ] as PaymentDocument['status'][],
          },
        }),
      )
      .sort({ created_at: -1, _id: -1 })
      .exec();
    if (!activePayment) {
      return;
    }
    await this.retireOrBlockStaleCheckout(activePayment, this.requireRuntime());
  }

  async handleWebhook(rawBody: Buffer | string, signature: string | undefined) {
    const runtime = this.requireRuntime();
    if (!signature) {
      throw new BadRequestException('Missing Stripe signature');
    }

    let event: Stripe.Event;
    try {
      event = this.getStripe(runtime).webhooks.constructEvent(
        rawBody,
        signature,
        runtime.webhookSecret,
      );
    } catch (error) {
      throw new BadRequestException(
        `Invalid Stripe webhook signature: ${this.errorMessage(error)}`,
      );
    }
    this.assertExpectedStripeEvent(event, runtime);

    await this.insertInboxEvent(event);
    const claimed = await this.claimInboxEvent(event.id);
    if (!claimed) {
      const existing = await this.stripeEventInboxModel
        .findOne({ stripe_event_id: event.id })
        .select('processing_status')
        .lean()
        .exec();
      if (
        existing?.processing_status === 'processed' ||
        existing?.processing_status === 'ignored'
      ) {
        return { received: true, duplicate: true };
      }
      throw new ServiceUnavailableException(
        'Stripe event is already being processed. Retry delivery.',
      );
    }

    try {
      const processed = await this.processEvent(event, runtime);
      await this.stripeEventInboxModel
        .updateOne(
          {
            stripe_event_id: event.id,
            processing_status: 'processing',
          },
          {
            $set: {
              processing_status: processed ? 'processed' : 'ignored',
              processed_at: new Date(),
              processing_started_at: null,
              last_error: null,
            },
          },
        )
        .exec();

      return { received: true, processed };
    } catch (error) {
      await this.stripeEventInboxModel
        .updateOne(
          {
            stripe_event_id: event.id,
            processing_status: 'processing',
          },
          {
            $set: {
              processing_status: 'failed',
              processing_started_at: null,
              last_error: this.errorMessage(error),
            },
          },
        )
        .exec();
      throw error;
    }
  }

  async listPayments(actor: AuthActor, query: Record<string, unknown>) {
    const page = this.boundedPositiveInt(query.page, 1, 1, 5000);
    const pageSize = this.boundedPositiveInt(query.page_size, 25, 1, 100);
    const filter: Record<string, unknown> = {
      organization_id: asObjectId(actor.organization_id, 'org id'),
    };

    if (typeof query.status === 'string' && query.status.trim()) {
      filter.status = query.status.trim();
    }
    if (typeof query.provider === 'string' && query.provider.trim()) {
      filter.provider = query.provider.trim();
    }
    if (typeof query.document_id === 'string' && query.document_id.trim()) {
      filter.document_id = asObjectId(query.document_id, 'document id');
    }

    const [items, totalCount] = await Promise.all([
      this.paymentModel
        .find(filter)
        .sort({ effective_at: -1, _id: -1 })
        .skip((page - 1) * pageSize)
        .limit(pageSize)
        .lean()
        .exec(),
      this.paymentModel.countDocuments(filter).exec(),
    ]);

    return { items, total_count: totalCount, page, page_size: pageSize };
  }

  async getPayment(paymentId: string, actor: AuthActor) {
    const payment = await this.paymentModel
      .findOne(
        withOrganizationScope(actor.organization_id, {
          _id: asObjectId(paymentId, 'payment id'),
        }),
      )
      .lean()
      .exec();

    if (!payment) {
      throw new NotFoundException('Payment not found');
    }

    const ledger_entries = await this.ledgerModel
      .find({
        organization_id: asObjectId(actor.organization_id, 'org id'),
        payment_id: payment._id,
      })
      .sort({ effective_at: -1, _id: -1 })
      .lean()
      .exec();

    return { payment, ledger_entries };
  }

  private async createCheckoutForInvoice(input: {
    document: OrgDocumentDocument;
    method: CheckoutPreference;
    runtime: RuntimeConfig;
    token: string | null;
    createdByUserId: string | null | undefined;
    source: 'public_invoice' | 'admin_invoice';
  }) {
    this.assertPayableInvoice(input.document);

    const client = await this.clientModel
      .findOne(
        withOrganizationScope(String(input.document.organization_id), {
          _id: input.document.client_id,
        }),
      )
      .exec();
    const customerEmail =
      client?.email?.trim() || input.document.client_snapshot.email?.trim();
    if (!customerEmail) {
      throw new ConflictException(
        'Add a client email before collecting online payment.',
      );
    }

    const amountMinor = input.document.balance_due_minor;
    const baseOperationKey = [
      'stripe-checkout',
      input.document._id,
      input.method,
      amountMinor,
      input.document.version,
    ].join(':');

    const checkoutLockKey = String(input.document._id);
    const activePayment = await this.paymentModel
      .findOne({
        organization_id: input.document.organization_id,
        document_id: input.document._id,
        provider: 'stripe',
        status: { $in: ['created', 'checkout_open', 'processing'] },
      })
      .sort({ created_at: -1, _id: -1 })
      .exec();
    const operationPattern = new RegExp(
      `^${this.escapeRegExp(baseOperationKey)}(?::retry:\\d+)?$`,
    );
    if (
      activePayment &&
      !operationPattern.test(activePayment.operation_idempotency_key ?? '')
    ) {
      await this.retireOrBlockStaleCheckout(activePayment, input.runtime);
    }

    const existingPayment = await this.paymentModel
      .findOne({
        organization_id: input.document.organization_id,
        operation_idempotency_key: {
          $regex: `^${this.escapeRegExp(baseOperationKey)}(?::retry:\\d+)?$`,
        },
        status: {
          $in: ['created', 'checkout_open', 'processing', 'succeeded'],
        },
      })
      .sort({ created_at: -1, _id: -1 })
      .exec();
    if (existingPayment) {
      const reusable = await this.recoverOrReuseCheckout({
        payment: existingPayment,
        document: input.document,
        method: input.method,
        runtime: input.runtime,
        token: input.token,
        source: input.source,
        customerEmail,
      });
      if (reusable) {
        return reusable;
      }
    }
    const previousAttemptCount = await this.paymentModel
      .countDocuments({
        organization_id: input.document.organization_id,
        operation_idempotency_key: {
          $regex: `^${this.escapeRegExp(baseOperationKey)}(?::retry:\\d+)?$`,
        },
      })
      .exec();
    const operationKey =
      previousAttemptCount > 0
        ? `${baseOperationKey}:retry:${previousAttemptCount + 1}`
        : baseOperationKey;

    const customer = await this.resolveStripeCustomer({
      runtime: input.runtime,
      document: input.document,
      client,
      email: customerEmail,
    });

    let payment: PaymentDocument;
    try {
      payment = await this.paymentModel.create({
        organization_id: input.document.organization_id,
        document_id: input.document._id,
        client_id: input.document.client_id,
        provider: 'stripe',
        amount_minor: amountMinor,
        currency: input.runtime.currency,
        status: 'created',
        method: 'other',
        purpose: 'invoice_balance',
        reference: null,
        note: null,
        provider_customer_id: customer.id,
        provider_account_id: null,
        provider_livemode: input.runtime.liveModeExpected === true,
        operation_idempotency_key: operationKey,
        checkout_lock_key: checkoutLockKey,
        effective_at: new Date(),
        created_by_user_id: input.createdByUserId
          ? asObjectId(input.createdByUserId, 'user id')
          : null,
      });
    } catch (error) {
      if (!this.isDuplicateKey(error)) {
        throw error;
      }
      const racedPayment = await this.paymentModel
        .findOne({
          organization_id: input.document.organization_id,
          operation_idempotency_key: operationKey,
        })
        .exec();
      if (!racedPayment) {
        const lockedPayment = await this.paymentModel
          .findOne({
            organization_id: input.document.organization_id,
            checkout_lock_key: checkoutLockKey,
          })
          .exec();
        if (lockedPayment) {
          throw new ConflictException(
            lockedPayment.status === 'processing'
              ? 'A payment is already processing for this invoice.'
              : 'Another payment session is already open for this invoice.',
          );
        }
        throw error;
      }
      const racedCheckout = await this.recoverOrReuseCheckout({
        payment: racedPayment,
        document: input.document,
        method: input.method,
        runtime: input.runtime,
        token: input.token,
        source: input.source,
        customerEmail,
      });
      if (racedCheckout) {
        return racedCheckout;
      }
      throw new ConflictException('Unable to start a second payment attempt.');
    }

    const session = await this.createStripeCheckoutSession({
      runtime: input.runtime,
      document: input.document,
      method: input.method,
      payment,
      customerId: customer.id,
      customerEmail,
      token: input.token,
      source: input.source,
    });

    payment.status = 'checkout_open';
    payment.provider_checkout_id = session.id;
    payment.provider_payment_intent_id =
      typeof session.payment_intent === 'string'
        ? session.payment_intent
        : null;
    payment.checkout_url = session.url ?? null;
    await payment.save();

    return {
      checkout_url: session.url,
      payment_id: String(payment._id),
      status: payment.status,
      method: payment.method,
      amount_minor: amountMinor,
      currency: input.runtime.currency,
    };
  }

  private async retireOrBlockStaleCheckout(
    payment: PaymentDocument,
    runtime: RuntimeConfig,
  ) {
    if (payment.status === 'processing') {
      throw new ConflictException(
        'A payment is already processing for this invoice.',
      );
    }

    if (payment.provider_checkout_id) {
      const stripe = this.getStripe(runtime);
      let session: Stripe.Checkout.Session;
      try {
        session = await stripe.checkout.sessions.retrieve(
          payment.provider_checkout_id,
        );
      } catch (error) {
        this.logger.warn(
          `Unable to verify stale Stripe Checkout Session ${payment.provider_checkout_id}: ${this.errorMessage(error)}`,
        );
        throw new ServiceUnavailableException(
          'Unable to verify the existing payment session. Please try again.',
        );
      }

      if (session.status === 'complete') {
        if (session.payment_status === 'paid') {
          await this.applyPaymentSuccessFromCheckoutSession(
            session,
            runtime,
            new Date(),
          );
          throw new ConflictException(
            'This invoice payment is already complete and is being applied.',
          );
        }
        payment.status = 'processing';
        await payment.save();
        throw new ConflictException(
          'A payment is already processing for this invoice.',
        );
      }

      if (session.status === 'open') {
        try {
          await stripe.checkout.sessions.expire(session.id);
        } catch (error) {
          this.logger.warn(
            `Unable to expire stale Stripe Checkout Session ${session.id}: ${this.errorMessage(error)}`,
          );
          throw new ServiceUnavailableException(
            'Unable to replace the existing payment session. Please try again.',
          );
        }
      }
    }

    payment.status = 'expired';
    payment.failed_at = new Date();
    payment.checkout_url = null;
    payment.checkout_lock_key = null;
    await payment.save();
  }

  private async recoverOrReuseCheckout(input: {
    payment: PaymentDocument;
    document: OrgDocumentDocument;
    method: CheckoutPreference;
    runtime: RuntimeConfig;
    token: string | null;
    source: 'public_invoice' | 'admin_invoice';
    customerEmail: string;
  }) {
    if (input.payment.status === 'processing') {
      throw new ConflictException(
        'A payment is already processing for this invoice.',
      );
    }

    if (input.payment.provider_checkout_id) {
      let stripeSession: Stripe.Checkout.Session;
      try {
        stripeSession = await this.getStripe(
          input.runtime,
        ).checkout.sessions.retrieve(input.payment.provider_checkout_id);
      } catch (error) {
        this.logger.warn(
          `Unable to verify Stripe Checkout Session ${input.payment.provider_checkout_id}: ${this.errorMessage(error)}`,
        );
        throw new ServiceUnavailableException(
          'Unable to verify the existing payment session. Please try again.',
        );
      }

      if (stripeSession.status === 'open' && stripeSession.url) {
        input.payment.checkout_url = stripeSession.url;
        input.payment.status = 'checkout_open';
        await input.payment.save();
        return this.checkoutResponse(input.payment, input.runtime.currency);
      }
      if (stripeSession.status === 'complete') {
        if (stripeSession.payment_status === 'paid') {
          await this.applyPaymentSuccessFromCheckoutSession(
            stripeSession,
            input.runtime,
            new Date(),
          );
        } else {
          input.payment.status = 'processing';
          await input.payment.save();
        }
        throw new ConflictException(
          stripeSession.payment_status === 'paid'
            ? 'This payment is already complete and is being applied.'
            : 'A payment is already processing for this invoice.',
        );
      }

      input.payment.status = 'expired';
      input.payment.failed_at = new Date();
      input.payment.checkout_url = null;
      input.payment.checkout_lock_key = null;
      await input.payment.save();
      return null;
    }

    if (input.payment.status !== 'created') {
      return null;
    }
    if (!input.payment.provider_customer_id) {
      throw new ConflictException(
        'Stripe customer is missing for this payment.',
      );
    }

    const stripeSession = await this.createStripeCheckoutSession({
      runtime: input.runtime,
      document: input.document,
      method: input.method,
      payment: input.payment,
      customerId: input.payment.provider_customer_id,
      customerEmail: input.customerEmail,
      token: input.token,
      source: input.source,
    });
    input.payment.status = 'checkout_open';
    input.payment.provider_checkout_id = stripeSession.id;
    input.payment.provider_payment_intent_id =
      typeof stripeSession.payment_intent === 'string'
        ? stripeSession.payment_intent
        : null;
    input.payment.checkout_url = stripeSession.url ?? null;
    await input.payment.save();
    return this.checkoutResponse(input.payment, input.runtime.currency);
  }

  private checkoutResponse(payment: PaymentDocument, currency: 'usd') {
    return {
      checkout_url: payment.checkout_url,
      payment_id: String(payment._id),
      status: payment.status,
      method: payment.method,
      amount_minor: payment.amount_minor,
      currency,
    };
  }

  private async createStripeCheckoutSession(input: {
    runtime: RuntimeConfig;
    document: OrgDocumentDocument;
    method: CheckoutPreference;
    payment: PaymentDocument;
    customerId: string;
    customerEmail: string;
    token: string | null;
    source: string;
  }) {
    const publicBase = input.runtime.publicAppBaseUrl;
    const invoiceId = String(input.document._id);
    const paymentId = String(input.payment._id);
    const successUrl = input.token
      ? `${publicBase}/view/invoice/${input.token}?payment=success&session_id={CHECKOUT_SESSION_ID}`
      : `${publicBase}/dashboard/invoices/${invoiceId}?payment=success&session_id={CHECKOUT_SESSION_ID}`;
    const cancelUrl = input.token
      ? `${publicBase}/view/invoice/${input.token}?payment=cancelled`
      : `${publicBase}/dashboard/invoices/${invoiceId}?payment=cancelled`;
    const metadata = {
      organization_id: String(input.document.organization_id),
      invoice_id: invoiceId,
      document_id: invoiceId,
      client_id: String(input.document.client_id),
      payment_id: paymentId,
      method: input.method,
      source: input.source,
    };

    const params: Stripe.Checkout.SessionCreateParams = {
      mode: 'payment',
      integration_identifier: this.checkoutIntegrationIdentifier(paymentId),
      customer: input.customerId,
      customer_email: undefined,
      line_items: [
        {
          quantity: 1,
          price_data: {
            currency: input.runtime.currency,
            unit_amount: input.document.balance_due_minor,
            product_data: {
              name: `Invoice ${input.document.number}`,
              description:
                input.document.job_name ??
                input.document.client_snapshot.display_name,
            },
          },
        },
      ],
      success_url: successUrl,
      cancel_url: cancelUrl,
      expires_at: Math.floor(Date.now() / 1000) + 31 * 60,
      invoice_creation: { enabled: false },
      metadata,
      payment_intent_data: {
        metadata,
      },
    };

    return this.getStripe(input.runtime).checkout.sessions.create(params, {
      idempotencyKey: `checkout-session:${paymentId}:v1`,
    });
  }

  private async resolveStripeCustomer(input: {
    runtime: RuntimeConfig;
    document: OrgDocumentDocument;
    client: ClientDocument | null;
    email: string;
  }) {
    const existing = await this.customerProfileModel
      .findOne(
        withOrganizationScope(String(input.document.organization_id), {
          provider: 'stripe' as const,
          provider_account_id: null,
          provider_livemode: input.runtime.liveModeExpected === true,
          client_id: input.document.client_id,
        }),
      )
      .exec();

    if (existing) {
      return { id: existing.provider_customer_id };
    }

    const customer = await this.getStripe(input.runtime).customers.create({
      email: input.email,
      name:
        input.client?.display_name ??
        input.document.client_snapshot.display_name ??
        undefined,
      metadata: {
        organization_id: String(input.document.organization_id),
        client_id: String(input.document.client_id),
      },
    });

    try {
      await this.customerProfileModel.create({
        organization_id: input.document.organization_id,
        client_id: input.document.client_id,
        provider: 'stripe',
        provider_account_id: null,
        provider_livemode: input.runtime.liveModeExpected === true,
        provider_customer_id: customer.id,
        email_snapshot: input.email,
        name_snapshot:
          input.client?.display_name ??
          input.document.client_snapshot.display_name,
      });
    } catch (error) {
      if (!this.isDuplicateKey(error)) {
        throw error;
      }
      const raced = await this.customerProfileModel
        .findOne(
          withOrganizationScope(String(input.document.organization_id), {
            provider: 'stripe' as const,
            provider_account_id: null,
            provider_livemode: input.runtime.liveModeExpected === true,
            client_id: input.document.client_id,
          }),
        )
        .exec();
      if (raced) {
        return { id: raced.provider_customer_id };
      }
    }

    return { id: customer.id };
  }

  private async processEvent(event: Stripe.Event, runtime: RuntimeConfig) {
    const eventAt = new Date(event.created * 1000);
    switch (event.type) {
      case 'checkout.session.completed':
        return this.handleCheckoutSessionCompleted(
          event.data.object,
          runtime,
          eventAt,
        );
      case 'checkout.session.expired':
        return this.updatePaymentFromCheckoutSession(
          event.data.object,
          'expired',
          runtime,
        );
      case 'checkout.session.async_payment_succeeded':
        return this.applyPaymentSuccessFromCheckoutSession(
          event.data.object,
          runtime,
          eventAt,
        );
      case 'checkout.session.async_payment_failed':
        return this.updatePaymentFromCheckoutSession(
          event.data.object,
          'failed',
          runtime,
        );
      case 'payment_intent.processing':
        return this.updatePaymentFromPaymentIntent(
          event.data.object,
          'processing',
          runtime,
        );
      case 'payment_intent.succeeded':
        return this.applyPaymentSuccessFromPaymentIntent(
          event.data.object,
          runtime,
          eventAt,
        );
      case 'payment_intent.payment_failed':
        return this.updatePaymentFromPaymentIntent(
          event.data.object,
          'failed',
          runtime,
        );
      case 'charge.refunded':
      case 'charge.updated':
        return this.applyRefundFromCharge(event.data.object, runtime, eventAt);
      case 'charge.dispute.created':
        return this.applyDisputeHold(event.data.object, runtime, eventAt);
      case 'charge.dispute.closed':
        return this.applyDisputeClosed(event.data.object, runtime, eventAt);
      default:
        return false;
    }
  }

  private async handleCheckoutSessionCompleted(
    session: Stripe.Checkout.Session,
    runtime: RuntimeConfig,
    eventAt: Date,
  ) {
    if (session.payment_status === 'paid') {
      return this.applyPaymentSuccessFromCheckoutSession(
        session,
        runtime,
        eventAt,
      );
    }
    return this.updatePaymentFromCheckoutSession(
      session,
      'processing',
      runtime,
    );
  }

  private async applyPaymentSuccessFromCheckoutSession(
    session: Stripe.Checkout.Session,
    runtime: RuntimeConfig,
    effectiveAt: Date,
  ) {
    const payment = await this.findPaymentByStripeReference({
      paymentId: this.metadataString(session.metadata, 'payment_id'),
      checkoutId: session.id,
      paymentIntentId:
        typeof session.payment_intent === 'string'
          ? session.payment_intent
          : undefined,
    });
    if (!payment) {
      return false;
    }
    await this.assertPaymentMatchesStripeObject(payment, session, runtime, {
      expectedAmountMinor: session.amount_total ?? payment.amount_minor,
      expectedCurrency: session.currency,
    });
    const paymentMethod = await this.resolveActualCheckoutMethod(
      session.payment_intent,
      runtime,
    );
    return this.applySuccessfulPayment(payment, {
      paymentIntentId:
        typeof session.payment_intent === 'string'
          ? session.payment_intent
          : payment.provider_payment_intent_id,
      chargeId: null,
      idempotencyKey: this.successLedgerKey({
        paymentIntentId:
          typeof session.payment_intent === 'string'
            ? session.payment_intent
            : payment.provider_payment_intent_id,
        checkoutId: session.id,
      }),
      amountMinor: session.amount_total ?? payment.amount_minor,
      effectiveAt,
      paymentMethod,
    });
  }

  private async applyPaymentSuccessFromPaymentIntent(
    intent: Stripe.PaymentIntent,
    runtime: RuntimeConfig,
    effectiveAt: Date,
  ) {
    const payment = await this.findPaymentByStripeReference({
      paymentId: this.metadataString(intent.metadata, 'payment_id'),
      paymentIntentId: intent.id,
    });
    if (!payment) {
      return false;
    }
    await this.assertPaymentMatchesStripeObject(payment, intent, runtime, {
      expectedAmountMinor: intent.amount_received || intent.amount,
      expectedCurrency: intent.currency,
    });
    const paymentMethod = await this.resolveActualCheckoutMethod(
      intent,
      runtime,
    );

    const latestCharge =
      typeof intent.latest_charge === 'string' ? intent.latest_charge : null;
    return this.applySuccessfulPayment(payment, {
      paymentIntentId: intent.id,
      chargeId: latestCharge,
      idempotencyKey: this.successLedgerKey({ paymentIntentId: intent.id }),
      amountMinor: intent.amount_received || intent.amount,
      effectiveAt,
      paymentMethod,
    });
  }

  private async applySuccessfulPayment(
    payment: PaymentDocument,
    input: {
      paymentIntentId: string | null;
      chargeId: string | null;
      idempotencyKey: string;
      amountMinor: number;
      effectiveAt: Date;
      paymentMethod: ResolvedStripePaymentMethod | null;
    },
  ) {
    const session = await this.connection.startSession();
    let insertedLedger = false;
    let appliedAmountMinor = 0;

    try {
      await session.withTransaction(async () => {
        const lockedPayment = await this.paymentModel
          .findById(payment._id, null, { session })
          .exec();
        if (!lockedPayment) {
          throw new NotFoundException('Payment not found');
        }

        const existingLedger = await this.ledgerModel
          .findOne(
            {
              organization_id: lockedPayment.organization_id,
              idempotency_key: input.idempotencyKey,
            },
            null,
            { session },
          )
          .exec();

        const document = await this.documentModel
          .findOne(
            {
              organization_id: lockedPayment.organization_id,
              _id: lockedPayment.document_id,
              type: 'invoice',
            },
            null,
            { session },
          )
          .exec();
        if (!document) {
          throw new NotFoundException('Invoice not found');
        }

        lockedPayment.status = this.nextPaymentStatus(
          lockedPayment.status,
          'succeeded',
        );
        lockedPayment.amount_minor = input.amountMinor;
        lockedPayment.provider_payment_intent_id =
          input.paymentIntentId ?? lockedPayment.provider_payment_intent_id;
        lockedPayment.provider_charge_id =
          input.chargeId ?? lockedPayment.provider_charge_id;
        lockedPayment.paid_at = input.effectiveAt;
        lockedPayment.effective_at = input.effectiveAt;
        lockedPayment.checkout_lock_key = null;
        if (input.paymentMethod) {
          lockedPayment.method = input.paymentMethod.method;
          lockedPayment.provider_payment_method_type =
            input.paymentMethod.providerType;
        }

        if (!existingLedger) {
          appliedAmountMinor = Math.min(
            input.amountMinor,
            Math.max(0, document.balance_due_minor),
          );
          if (appliedAmountMinor > 0) {
            await this.ledgerModel.create(
              [
                {
                  organization_id: lockedPayment.organization_id,
                  document_id: lockedPayment.document_id,
                  payment_id: lockedPayment._id,
                  entry_type: 'payment',
                  amount_minor: appliedAmountMinor,
                  currency: lockedPayment.currency,
                  provider_object_id: input.paymentIntentId,
                  idempotency_key: input.idempotencyKey,
                  effective_at: input.effectiveAt,
                  created_by_user_id: null,
                },
              ],
              { session },
            );
            document.amount_paid_minor += appliedAmountMinor;
            document.balance_due_minor = Math.max(
              0,
              document.balance_due_minor - appliedAmountMinor,
            );
            document.version += 1;
            await document.save({ session });
            insertedLedger = true;
          } else {
            lockedPayment.note =
              lockedPayment.note ??
              'Stripe confirmed this payment after the invoice balance was already paid. Review Stripe for refund handling.';
          }
        }

        await lockedPayment.save({ session });
      });
    } finally {
      await session.endSession();
    }

    payment.status = this.nextPaymentStatus(payment.status, 'succeeded');
    payment.amount_minor = input.amountMinor;
    payment.provider_payment_intent_id =
      input.paymentIntentId ?? payment.provider_payment_intent_id;
    payment.provider_charge_id = input.chargeId ?? payment.provider_charge_id;
    payment.paid_at = input.effectiveAt;
    payment.effective_at = input.effectiveAt;
    payment.checkout_lock_key = null;
    if (input.paymentMethod) {
      payment.method = input.paymentMethod.method;
      payment.provider_payment_method_type = input.paymentMethod.providerType;
    }

    if (insertedLedger) {
      await this.paymentsService.recomputeInvoiceTotals(
        String(payment.document_id),
        String(payment.organization_id),
      );
    }
    await this.sendPaymentNotificationSafely({
      payment,
      eventType: 'payment.succeeded',
      message:
        insertedLedger && appliedAmountMinor !== input.amountMinor
          ? 'Invoice payment received and capped to the remaining invoice balance.'
          : 'Invoice payment received.',
    });
    return true;
  }

  private async updatePaymentFromCheckoutSession(
    session: Stripe.Checkout.Session,
    status: PaymentDocument['status'],
    runtime: RuntimeConfig,
  ) {
    const payment = await this.findPaymentByStripeReference({
      paymentId: this.metadataString(session.metadata, 'payment_id'),
      checkoutId: session.id,
      paymentIntentId:
        typeof session.payment_intent === 'string'
          ? session.payment_intent
          : undefined,
    });
    if (!payment) {
      return false;
    }
    await this.assertPaymentMatchesStripeObject(payment, session, runtime, {
      expectedAmountMinor: session.amount_total ?? payment.amount_minor,
      expectedCurrency: session.currency,
    });
    const nextStatus = this.nextPaymentStatus(payment.status, status);
    if (nextStatus === payment.status && nextStatus !== status) {
      return false;
    }
    payment.status = nextStatus;
    payment.provider_checkout_id = session.id;
    payment.provider_payment_intent_id =
      typeof session.payment_intent === 'string'
        ? session.payment_intent
        : payment.provider_payment_intent_id;
    const paymentMethod = await this.resolveActualCheckoutMethod(
      session.payment_intent,
      runtime,
    );
    if (paymentMethod) {
      payment.method = paymentMethod.method;
      payment.provider_payment_method_type = paymentMethod.providerType;
    }
    if (status === 'failed' || status === 'expired') {
      payment.failed_at = new Date();
      payment.checkout_lock_key = null;
      payment.checkout_url = null;
    }
    await payment.save();
    return true;
  }

  private async updatePaymentFromPaymentIntent(
    intent: Stripe.PaymentIntent,
    status: PaymentDocument['status'],
    runtime: RuntimeConfig,
  ) {
    const payment = await this.findPaymentByStripeReference({
      paymentId: this.metadataString(intent.metadata, 'payment_id'),
      paymentIntentId: intent.id,
    });
    if (!payment) {
      return false;
    }
    await this.assertPaymentMatchesStripeObject(payment, intent, runtime, {
      expectedAmountMinor: intent.amount_received || intent.amount,
      expectedCurrency: intent.currency,
    });
    const nextStatus = this.nextPaymentStatus(payment.status, status);
    if (nextStatus === payment.status && nextStatus !== status) {
      return false;
    }
    payment.status = nextStatus;
    payment.provider_payment_intent_id = intent.id;
    const paymentMethod = await this.resolveActualCheckoutMethod(
      intent,
      runtime,
    );
    if (paymentMethod) {
      payment.method = paymentMethod.method;
      payment.provider_payment_method_type = paymentMethod.providerType;
    }
    if (typeof intent.latest_charge === 'string') {
      payment.provider_charge_id = intent.latest_charge;
    }
    if (status === 'failed') {
      payment.failed_at = new Date();
      payment.failure_message =
        intent.last_payment_error?.message ?? 'Stripe payment failed.';
      payment.checkout_lock_key = null;
      payment.checkout_url = null;
    }
    await payment.save();
    return true;
  }

  private async applyRefundFromCharge(
    charge: Stripe.Charge,
    runtime: RuntimeConfig,
    effectiveAt: Date,
  ) {
    if (!charge.refunded && (charge.amount_refunded ?? 0) <= 0) {
      return false;
    }
    const payment = await this.findPaymentForCharge(charge, runtime);
    if (!payment) {
      return false;
    }
    await this.assertPaymentMatchesStripeObject(payment, charge, runtime, {
      expectedCurrency: charge.currency,
    });

    const cumulativeRefundAmount = charge.amount_refunded ?? 0;
    if (cumulativeRefundAmount <= 0) {
      return false;
    }
    const idempotencyKey = `stripe:charge:${charge.id}:refund:${cumulativeRefundAmount}`;
    let insertedRefund = false;
    const session = await this.connection.startSession();
    try {
      await session.withTransaction(async () => {
        const lockedPayment = await this.paymentModel
          .findById(payment._id, null, { session })
          .exec();
        if (!lockedPayment) {
          throw new NotFoundException('Payment not found');
        }
        const alreadyLedgered = await this.ledgerModel
          .find(
            {
              organization_id: lockedPayment.organization_id,
              payment_id: lockedPayment._id,
              entry_type: 'refund',
              provider_object_id: charge.id,
            },
            null,
            { session },
          )
          .lean()
          .exec();
        const alreadyRefunded = alreadyLedgered.reduce(
          (total, entry) => total + Math.abs(entry.amount_minor),
          0,
        );
        const refundDelta = cumulativeRefundAmount - alreadyRefunded;
        if (refundDelta <= 0) {
          return;
        }
        await this.ledgerModel.updateOne(
          {
            organization_id: lockedPayment.organization_id,
            idempotency_key: idempotencyKey,
          },
          {
            $setOnInsert: {
              organization_id: lockedPayment.organization_id,
              document_id: lockedPayment.document_id,
              payment_id: lockedPayment._id,
              entry_type: 'refund',
              amount_minor: -refundDelta,
              currency: lockedPayment.currency,
              provider_object_id: charge.id,
              idempotency_key: idempotencyKey,
              effective_at: effectiveAt,
              created_by_user_id: null,
            },
          },
          { upsert: true, session },
        );
        lockedPayment.status =
          cumulativeRefundAmount >= lockedPayment.amount_minor
            ? 'refunded'
            : 'partially_refunded';
        lockedPayment.provider_charge_id = charge.id;
        await lockedPayment.save({ session });
        insertedRefund = true;
      });
    } finally {
      await session.endSession();
    }
    if (!insertedRefund) {
      return false;
    }
    payment.status =
      cumulativeRefundAmount >= payment.amount_minor
        ? 'refunded'
        : 'partially_refunded';
    payment.provider_charge_id = charge.id;
    await this.paymentsService.recomputeInvoiceTotals(
      String(payment.document_id),
      String(payment.organization_id),
    );
    await this.sendPaymentNotificationSafely({
      payment,
      eventType: 'payment.refunded',
      message: 'Invoice payment was refunded.',
    });
    return true;
  }

  private successLedgerKey(input: {
    paymentIntentId?: string | null;
    checkoutId?: string | null;
  }) {
    return input.paymentIntentId
      ? `stripe:payment_intent:${input.paymentIntentId}:payment`
      : `stripe:checkout:${input.checkoutId}:payment`;
  }

  private assertExpectedStripeEvent(
    event: Stripe.Event,
    runtime: RuntimeConfig,
  ) {
    if (
      runtime.liveModeExpected !== null &&
      event.livemode !== runtime.liveModeExpected
    ) {
      throw new BadRequestException(
        'Unexpected Stripe livemode for webhook event.',
      );
    }
  }

  private async assertPaymentMatchesStripeObject(
    payment: PaymentDocument,
    object: StripeEventObject,
    runtime: RuntimeConfig,
    expected: {
      expectedAmountMinor?: number | null;
      expectedCurrency?: string | null;
    } = {},
  ) {
    const metadata = 'metadata' in object ? (object.metadata ?? null) : null;
    const metadataPaymentId = this.metadataString(metadata, 'payment_id');
    const metadataDocumentId =
      this.metadataString(metadata, 'invoice_id') ??
      this.metadataString(metadata, 'document_id');
    const metadataClientId = this.metadataString(metadata, 'client_id');
    const metadataOrganizationId = this.metadataString(
      metadata,
      'organization_id',
    );

    if (metadataPaymentId && metadataPaymentId !== String(payment._id)) {
      throw new BadRequestException(
        'Stripe event payment metadata does not match local payment.',
      );
    }
    if (
      metadataDocumentId &&
      metadataDocumentId !== String(payment.document_id)
    ) {
      throw new BadRequestException(
        'Stripe event invoice metadata does not match local invoice.',
      );
    }
    if (metadataClientId && metadataClientId !== String(payment.client_id)) {
      throw new BadRequestException(
        'Stripe event client metadata does not match local client.',
      );
    }
    if (
      metadataOrganizationId &&
      metadataOrganizationId !== String(payment.organization_id)
    ) {
      throw new BadRequestException(
        'Stripe event company metadata does not match local company.',
      );
    }
    if (
      expected.expectedCurrency &&
      expected.expectedCurrency.toLowerCase() !== payment.currency
    ) {
      throw new BadRequestException(
        'Stripe event currency does not match local payment.',
      );
    }
    if (
      typeof expected.expectedAmountMinor === 'number' &&
      expected.expectedAmountMinor > 0 &&
      expected.expectedAmountMinor !== payment.amount_minor
    ) {
      throw new BadRequestException(
        'Stripe event amount does not match local payment.',
      );
    }

    const livemode =
      typeof object.livemode === 'boolean' ? object.livemode : null;
    if (livemode !== null && livemode !== payment.provider_livemode) {
      throw new BadRequestException(
        'Stripe event livemode does not match local payment.',
      );
    }
    const document = await this.documentModel
      .findOne({
        organization_id: payment.organization_id,
        _id: payment.document_id,
        type: 'invoice',
        client_id: payment.client_id,
      })
      .lean()
      .exec();
    if (!document) {
      throw new NotFoundException('Invoice not found for Stripe payment.');
    }
  }

  private nextPaymentStatus(
    current: PaymentDocument['status'],
    incoming: PaymentDocument['status'],
  ): PaymentDocument['status'] {
    const terminal = new Set<PaymentDocument['status']>([
      'succeeded',
      'partially_refunded',
      'refunded',
      'disputed',
      'dispute_lost',
    ]);
    const transient = new Set<PaymentDocument['status']>([
      'created',
      'checkout_open',
      'processing',
      'failed',
      'expired',
      'requires_action',
      'canceled',
    ]);

    if (terminal.has(current) && transient.has(incoming)) {
      return current;
    }
    if (
      (current === 'partially_refunded' || current === 'refunded') &&
      incoming === 'succeeded'
    ) {
      return current;
    }
    return incoming;
  }

  private async applyDisputeHold(
    dispute: Stripe.Dispute,
    runtime: RuntimeConfig,
    effectiveAt: Date,
  ) {
    const payment = await this.findPaymentForDispute(dispute, runtime);
    if (!payment) {
      return false;
    }
    await this.assertPaymentMatchesStripeObject(payment, dispute, runtime, {
      expectedCurrency: dispute.currency,
    });
    const amount = dispute.amount ?? 0;
    if (amount <= 0) {
      return false;
    }
    await this.ledgerModel.updateOne(
      {
        organization_id: payment.organization_id,
        idempotency_key: `stripe:dispute:${dispute.id}:hold`,
      },
      {
        $setOnInsert: {
          organization_id: payment.organization_id,
          document_id: payment.document_id,
          payment_id: payment._id,
          entry_type: 'dispute_hold',
          amount_minor: -amount,
          currency: payment.currency,
          provider_object_id: dispute.id,
          idempotency_key: `stripe:dispute:${dispute.id}:hold`,
          effective_at: effectiveAt,
          created_by_user_id: null,
        },
      },
      { upsert: true },
    );
    const reversalExists = await this.ledgerModel.exists({
      organization_id: payment.organization_id,
      idempotency_key: `stripe:dispute:${dispute.id}:reversal`,
    });
    if (!reversalExists && payment.status !== 'dispute_lost') {
      payment.status = 'disputed';
    }
    await payment.save();
    await this.paymentsService.recomputeInvoiceTotals(
      String(payment.document_id),
      String(payment.organization_id),
    );
    await this.sendPaymentNotificationSafely({
      payment,
      eventType: 'payment.disputed',
      message: 'Invoice payment was disputed.',
    });
    return true;
  }

  private async applyDisputeClosed(
    dispute: Stripe.Dispute,
    runtime: RuntimeConfig,
    effectiveAt: Date,
  ) {
    const payment = await this.findPaymentForDispute(dispute, runtime);
    if (!payment) {
      return false;
    }
    await this.assertPaymentMatchesStripeObject(payment, dispute, runtime, {
      expectedCurrency: dispute.currency,
    });
    if (
      dispute.status === 'won' ||
      dispute.status === 'warning_closed' ||
      dispute.status === 'prevented'
    ) {
      await this.ledgerModel.updateOne(
        {
          organization_id: payment.organization_id,
          idempotency_key: `stripe:dispute:${dispute.id}:reversal`,
        },
        {
          $setOnInsert: {
            organization_id: payment.organization_id,
            document_id: payment.document_id,
            payment_id: payment._id,
            entry_type: 'dispute_reversal',
            amount_minor: dispute.amount ?? 0,
            currency: payment.currency,
            provider_object_id: dispute.id,
            idempotency_key: `stripe:dispute:${dispute.id}:reversal`,
            effective_at: effectiveAt,
            created_by_user_id: null,
          },
        },
        { upsert: true },
      );
      payment.status = this.nextPaymentStatus(payment.status, 'succeeded');
    } else if (dispute.status === 'lost') {
      payment.status = 'dispute_lost';
    } else {
      return false;
    }
    await payment.save();
    await this.paymentsService.recomputeInvoiceTotals(
      String(payment.document_id),
      String(payment.organization_id),
    );
    await this.sendPaymentNotificationSafely({
      payment,
      eventType: 'payment.dispute.closed',
      message: 'Invoice dispute was closed.',
    });
    return true;
  }

  private async sendPaymentNotificationSafely(input: {
    payment: PaymentDocument;
    eventType: string;
    message: string;
  }) {
    try {
      await this.paymentNotifications.send(input);
    } catch (error) {
      this.logger.error(
        `Payment recorded but notification failed for payment=${String(input.payment._id)} event=${input.eventType}: ${this.errorMessage(error)}`,
      );
    }
  }

  private async findPaymentForCharge(
    charge: Stripe.Charge,
    runtime: RuntimeConfig,
  ) {
    const paymentIntentId =
      typeof charge.payment_intent === 'string'
        ? charge.payment_intent
        : undefined;
    const existing = await this.findPaymentByStripeReference({
      paymentIntentId,
      chargeId: charge.id,
    });
    if (existing || !paymentIntentId) {
      return existing;
    }

    const intent =
      await this.getStripe(runtime).paymentIntents.retrieve(paymentIntentId);
    const metadataPaymentId = this.metadataString(
      intent.metadata,
      'payment_id',
    );
    if (!metadataPaymentId) {
      return null;
    }
    const payment = await this.findPaymentByStripeReference({
      paymentId: metadataPaymentId,
      paymentIntentId,
      chargeId: charge.id,
    });
    if (!payment) {
      throw new ServiceUnavailableException(
        'Stripe payment metadata exists but the local payment is not available yet.',
      );
    }
    return payment;
  }

  private async findPaymentForDispute(
    dispute: Stripe.Dispute,
    runtime: RuntimeConfig,
  ) {
    const chargeId =
      typeof dispute.charge === 'string' ? dispute.charge : undefined;
    const paymentIntentId =
      typeof dispute.payment_intent === 'string'
        ? dispute.payment_intent
        : undefined;
    const existing = await this.findPaymentByStripeReference({
      paymentIntentId,
      chargeId,
    });
    if (existing) {
      return existing;
    }
    if (paymentIntentId) {
      const intent =
        await this.getStripe(runtime).paymentIntents.retrieve(paymentIntentId);
      const metadataPaymentId = this.metadataString(
        intent.metadata,
        'payment_id',
      );
      if (metadataPaymentId) {
        const payment = await this.findPaymentByStripeReference({
          paymentId: metadataPaymentId,
          paymentIntentId,
          chargeId,
        });
        if (!payment) {
          throw new ServiceUnavailableException(
            'Stripe dispute metadata exists but the local payment is not available yet.',
          );
        }
        return payment;
      }
    }
    if (!chargeId) {
      return null;
    }
    const charge = await this.getStripe(runtime).charges.retrieve(chargeId);
    return this.findPaymentForCharge(charge, runtime);
  }

  private async findPaymentByStripeReference(input: {
    paymentId?: string | null;
    checkoutId?: string;
    paymentIntentId?: string;
    chargeId?: string;
  }) {
    if (input.paymentId && Types.ObjectId.isValid(input.paymentId)) {
      const byId = await this.paymentModel.findById(input.paymentId).exec();
      if (byId) {
        return byId;
      }
    }

    const or: Record<string, string>[] = [];
    if (input.checkoutId) {
      or.push({ provider_checkout_id: input.checkoutId });
    }
    if (input.paymentIntentId) {
      or.push({ provider_payment_intent_id: input.paymentIntentId });
    }
    if (input.chargeId) {
      or.push({ provider_charge_id: input.chargeId });
    }
    if (or.length === 0) {
      return null;
    }

    return this.paymentModel.findOne({ provider: 'stripe', $or: or }).exec();
  }

  private async insertInboxEvent(event: Stripe.Event): Promise<void> {
    try {
      await this.stripeEventInboxModel.create({
        stripe_event_id: event.id,
        event_type: event.type,
        livemode: event.livemode,
        stripe_account_id:
          typeof event.account === 'string' ? event.account : null,
        processing_status: 'received',
        processed_at: null,
        last_error: null,
        payload: event as unknown as Record<string, unknown>,
      });
      return;
    } catch (error) {
      if (this.isDuplicateKey(error)) {
        return;
      }
      throw error;
    }
  }

  private async claimInboxEvent(eventId: string) {
    const staleBefore = new Date(Date.now() - STRIPE_WEBHOOK_LEASE_MS);
    return this.stripeEventInboxModel
      .findOneAndUpdate(
        {
          stripe_event_id: eventId,
          $or: [
            { processing_status: { $in: ['received', 'failed'] } },
            {
              processing_status: 'processing',
              processing_started_at: { $lte: staleBefore },
            },
          ],
        },
        {
          $set: {
            processing_status: 'processing',
            processing_started_at: new Date(),
            last_error: null,
          },
        },
        { new: true },
      )
      .lean()
      .exec();
  }

  private assertPayableInvoice(document: OrgDocumentDocument) {
    if (document.type !== 'invoice') {
      throw new NotFoundException('Invoice not found');
    }
    if (document.status === 'void') {
      throw new ConflictException('Voided invoices cannot be paid online.');
    }
    if (!document.online_payments_enabled) {
      throw new ConflictException(
        'Online payments are not enabled for this invoice.',
      );
    }
    if (document.balance_due_minor <= 0) {
      throw new ConflictException('This invoice has no balance due.');
    }
  }

  private resolvePublicDisabledReason(
    document: OrgDocumentDocument,
    runtime: RuntimeConfig,
    clientEmail: string | null,
  ) {
    if (!runtime.enabled) {
      return 'Online payments are not available yet.';
    }
    if (!document.online_payments_enabled) {
      return 'Online payments are not enabled for this invoice.';
    }
    if (document.status === 'void') {
      return 'This invoice is void.';
    }
    if (document.balance_due_minor <= 0) {
      return 'This invoice has no balance due.';
    }
    if (!clientEmail) {
      return 'This invoice is missing a client email.';
    }
    return null;
  }

  private async resolveActualCheckoutMethod(
    paymentIntent: string | Stripe.PaymentIntent | null,
    runtime: RuntimeConfig,
  ): Promise<ResolvedStripePaymentMethod | null> {
    if (!paymentIntent) {
      return null;
    }

    const intent =
      typeof paymentIntent === 'string'
        ? await this.getStripe(runtime).paymentIntents.retrieve(paymentIntent, {
            expand: ['payment_method'],
          })
        : paymentIntent;
    const method = intent.payment_method;
    const paymentMethod =
      typeof method === 'string'
        ? await this.getStripe(runtime).paymentMethods.retrieve(method)
        : method;

    if (!paymentMethod?.type) {
      return null;
    }
    const providerType =
      paymentMethod.type === 'card' && paymentMethod.card?.wallet?.type
        ? paymentMethod.card.wallet.type
        : paymentMethod.type;
    return {
      method:
        paymentMethod.type === 'us_bank_account'
          ? 'ach'
          : paymentMethod.type === 'card'
            ? 'card'
            : 'other',
      providerType,
    };
  }

  private requireRuntime() {
    const runtime = this.getRuntimeConfig(true);
    if (!runtime.enabled) {
      throw new ServiceUnavailableException('Online payments are disabled.');
    }
    return runtime;
  }

  private getRuntimeConfig(requireSecrets: boolean): RuntimeConfig {
    const enabled = this.boolEnv('ONLINE_INVOICE_PAYMENTS_ENABLED', false);
    const secretKey = this.configService.get<string>('STRIPE_SECRET_KEY') ?? '';
    const webhookSecret =
      this.configService.get<string>('STRIPE_WEBHOOK_SECRET') ?? '';
    const publicAppBaseUrl =
      this.configService.get<string>('PUBLIC_APP_BASE_URL') ??
      this.configService.get<string>('FRONTEND_ORIGIN') ??
      '';

    if (requireSecrets || enabled) {
      if (!secretKey) {
        throw new ServiceUnavailableException(
          'STRIPE_SECRET_KEY is not configured.',
        );
      }
      if (!webhookSecret) {
        throw new ServiceUnavailableException(
          'STRIPE_WEBHOOK_SECRET is not configured.',
        );
      }
      if (!publicAppBaseUrl) {
        throw new ServiceUnavailableException(
          'PUBLIC_APP_BASE_URL is not configured.',
        );
      }
    }

    return {
      enabled,
      secretKey,
      webhookSecret,
      publicAppBaseUrl,
      currency: 'usd',
      liveModeExpected: this.optionalBoolEnv('STRIPE_LIVEMODE_EXPECTED'),
    };
  }

  private checkoutIntegrationIdentifier(paymentId: string) {
    const suffix = paymentId
      .slice(-8)
      .split('')
      .map((character) =>
        String.fromCharCode(97 + Number.parseInt(character, 16)),
      )
      .join('');
    return `homepro_${suffix}`;
  }

  private getStripe(runtime: RuntimeConfig) {
    if (this.stripeClient && this.stripeClientKey === runtime.secretKey) {
      return this.stripeClient;
    }
    this.stripeClient = new Stripe(runtime.secretKey);
    this.stripeClientKey = runtime.secretKey;
    return this.stripeClient;
  }

  private boolEnv(key: string, fallback: boolean) {
    const value = this.configService.get<string>(key);
    if (value == null || value === '') {
      return fallback;
    }
    return ['true', '1', 'yes', 'on'].includes(value.toLowerCase());
  }

  private optionalBoolEnv(key: string) {
    const value = this.configService.get<string>(key);
    if (value == null || value === '') {
      return null;
    }
    return ['true', '1', 'yes', 'on'].includes(value.toLowerCase());
  }

  private boundedPositiveInt(
    value: unknown,
    fallback: number,
    min: number,
    max: number,
  ) {
    const parsed =
      typeof value === 'string' ? Number.parseInt(value, 10) : Number(value);
    if (!Number.isInteger(parsed)) {
      return fallback;
    }
    return Math.min(max, Math.max(min, parsed));
  }

  private metadataString(
    metadata: Stripe.Metadata | null | undefined,
    key: string,
  ) {
    const value = metadata?.[key];
    return typeof value === 'string' && value.trim() ? value : null;
  }

  private escapeRegExp(value: string) {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  private isDuplicateKey(error: unknown) {
    return (
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      (error as { code?: number }).code === 11000
    );
  }

  private errorMessage(error: unknown) {
    return error instanceof Error ? error.message : String(error);
  }
}
