import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleDestroy,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import { existsSync } from 'fs';
import { ClientSession, Model } from 'mongoose';
import puppeteer, { type Browser } from 'puppeteer';
import { Resend } from 'resend';
import {
  type InvoiceEmailMessageModel,
  type InvoiceDocumentModel,
  renderInvoiceEmailMessageHtml,
  renderInvoiceDocumentHtml,
} from './invoice-template';
import {
  INVOICE_LOGO_BUFFER,
  INVOICE_LOGO_CONTENT_ID,
} from './invoice-logo';
import { generateOrderId } from '../common/utils/order-id';
import { asObjectId } from '../common/utils/object-id';
import {
  AuditLog,
  AuditLogDocument,
} from '../audit-logs/schemas/audit-log.schema';
import { PaidStatus } from '../common/enums/paid-status.enum';
import {
  Customer,
  CustomerDocument,
} from '../customers/schemas/customer.schema';
import {
  AppSettings,
  AppSettingsDocument,
} from '../settings/schemas/app-settings.schema';
import { Vehicle, VehicleDocument } from '../vehicles/schemas/vehicle.schema';
import { Estimate, EstimateDocument } from './schemas/estimate.schema';
import {
  EstimateInvoiceSnapshot,
  EstimateInvoiceSnapshotDocument,
} from './schemas/estimate-invoice-snapshot.schema';
import {
  EstimateInvoiceDispatch,
  EstimateInvoiceDispatchDocument,
} from './schemas/estimate-invoice-dispatch.schema';
import { EstimateInvoiceSnapshotStatus } from './enums/estimate-invoice-snapshot-status.enum';
import { EstimateInvoiceDispatchStatus } from './enums/estimate-invoice-dispatch-status.enum';
import {
  resolveEstimatePaymentState,
  resolveEstimateTotals,
} from '../common/calculators/estimate-calculators';

type InvoiceCustomerSnapshot = {
  customer_id: string;
  name: string;
  email: string | null;
  phone: string;
};

type InvoiceVehicleSnapshot = {
  vehicle_id: string;
  label: string;
  vin: string | null;
  license_plate: string | null;
  year: number | null;
  make: string | null;
  model: string | null;
  mileage: number | null;
  mileage_out: number | null;
};

type InvoiceLaborSnapshot = {
  description: string;
  hours: number;
  rate: number;
  discount_percent: number;
  subtotal: number;
};

type InvoicePartSnapshot = {
  name: string;
  part_number: string | null;
  quantity: number;
  cost: number | null;
  price: number;
  discount_percent: number;
  subtotal: number;
};

type InvoiceServiceSnapshot = {
  estimate_service_id: string;
  canned_service_id: string | null;
  name: string;
  note: string | null;
  labor_lines: InvoiceLaborSnapshot[];
  part_lines: InvoicePartSnapshot[];
  labor_total: number;
  parts_total: number;
  total: number;
};

type InvoiceDocumentPayload = {
  estimate_id: string;
  estimate_number_snapshot: string;
  title_snapshot: string;
  time_zone_snapshot: string;
  complaint_or_request_snapshot: string | null;
  recommendation_snapshot: string | null;
  customer_snapshot: InvoiceCustomerSnapshot;
  vehicle_snapshot: InvoiceVehicleSnapshot;
  services_snapshot: InvoiceServiceSnapshot[];
  subtotal_snapshot: number;
  tax_rate_snapshot: number;
  tax_amount_snapshot: number;
  total: number;
  amount_paid_snapshot: number;
  amount_remaining_snapshot: number;
  payment_status_snapshot: PaidStatus;
  payment_type_snapshot: string;
  due_date_snapshot: string | null;
  scheduled_start_snapshot: string | null;
  scheduled_end_snapshot: string | null;
  generated_at: string;
};

type InvoiceRenderPayload = InvoiceDocumentPayload & {
  invoice_number?: string;
};

type SerializedInvoiceSnapshot = InvoiceRenderPayload & {
  id: string;
  estimate_id: string;
  invoice_number: string;
  revision_number: number;
  status: EstimateInvoiceSnapshotStatus;
  billable_hash: string;
  issued_at: string | null;
  sent_at: string | null;
  stale_at: string | null;
  superseded_by_snapshot_id: string | null;
  created_at: string | null;
  updated_at: string | null;
};

type SerializedInvoiceDispatch = {
  id: string;
  estimate_id: string;
  invoice_snapshot_id: string;
  recipient_email: string;
  provider: string;
  provider_message_id: string | null;
  delivery_status: EstimateInvoiceDispatchStatus;
  error_message: string | null;
  sent_at: string | null;
  created_at: string | null;
  updated_at: string | null;
};

type InvoiceAggregate = {
  estimate: EstimateDocument;
  customer: CustomerDocument;
  vehicle: VehicleDocument;
  payload: InvoiceDocumentPayload;
  blockers: string[];
  billableHash: string;
};

type InvoiceEmailResult = {
  provider: string;
  providerMessageId: string;
};

type InvoiceEmailTransport = 'LOG' | 'DISABLED' | 'RESEND';

type EstimateInvoiceListSummary = {
  invoice_status: EstimateInvoiceSnapshotStatus | null;
  latest_invoice_number: string | null;
  invoice_ready: boolean;
  send_ready: boolean;
  invoice_needs_refresh: boolean;
};

type EstimateBillingSummaryListInput = {
  estimate_id: string;
  customer_id: string;
  total: number;
  services_count: number;
  payment_status: PaidStatus;
  amount_paid: number;
};

type InvoiceBillingReadiness = {
  pdfBlockers: string[];
  sendBlockers: string[];
};

const PUBLIC_MAILBOX_DOMAINS = new Set([
  'gmail.com',
  'googlemail.com',
  'yahoo.com',
  'ymail.com',
  'rocketmail.com',
  'outlook.com',
  'hotmail.com',
  'live.com',
  'msn.com',
  'icloud.com',
  'me.com',
  'mac.com',
  'aol.com',
]);

const RECENT_INVOICE_DISPATCH_WINDOW_MS = 2 * 60 * 1000;
const EMPTY_INVOICE_NOTE_VALUES = new Set(['-', '—', '--', 'n/a', 'na', 'none']);
const PDF_BROWSER_EXECUTABLE_CANDIDATES = [
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
  '/usr/bin/google-chrome',
  '/usr/bin/google-chrome-stable',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
];
const CUSTOMER_EMAIL_INVOICE_BLOCKER =
  'Customer email is required before an invoice can be issued or sent.';
const BILLABLE_INVOICE_BLOCKER =
  'Add at least one billable line before issuing an invoice.';
const PART_PAID_INVOICE_BLOCKER =
  'Part-paid invoices require a paid amount greater than zero before sending.';

function normalizeInvoiceOptionalText(value: unknown) {
  if (typeof value !== 'string') {
    return null;
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  return EMPTY_INVOICE_NOTE_VALUES.has(trimmed.toLowerCase())
    ? null
    : trimmed;
}

@Injectable()
export class EstimateInvoiceService implements OnModuleDestroy {
  private readonly logger = new Logger(EstimateInvoiceService.name);
  private resendClient: Resend | null = null;
  private pdfBrowserPromise: Promise<Browser> | null = null;
  private invoiceRuntimeReadinessPromise: Promise<{
    pdfBlockers: string[];
    sendBlockers: string[];
  }> | null = null;
  private invoiceRuntimeReadinessExpiresAt = 0;

  constructor(
    @InjectModel(Estimate.name)
    private readonly estimateModel: Model<EstimateDocument>,
    @InjectModel(Customer.name)
    private readonly customerModel: Model<CustomerDocument>,
    @InjectModel(Vehicle.name)
    private readonly vehicleModel: Model<VehicleDocument>,
    @InjectModel(EstimateInvoiceSnapshot.name)
    private readonly estimateInvoiceSnapshotModel: Model<EstimateInvoiceSnapshotDocument>,
    @InjectModel(EstimateInvoiceDispatch.name)
    private readonly estimateInvoiceDispatchModel: Model<EstimateInvoiceDispatchDocument>,
    @InjectModel(AppSettings.name)
    private readonly appSettingsModel: Model<AppSettingsDocument>,
    @InjectModel(AuditLog.name)
    private readonly auditLogModel: Model<AuditLogDocument>,
    private readonly configService: ConfigService,
  ) {}

  async onModuleDestroy() {
    if (!this.pdfBrowserPromise) {
      return;
    }

    const browser = await this.pdfBrowserPromise.catch(() => null);
    this.pdfBrowserPromise = null;

    if (browser) {
      await browser.close().catch(() => undefined);
    }
  }

  async getInvoicePreview(estimateId: string) {
    const aggregate = await this.loadInvoiceAggregate(estimateId);
    const latestSnapshot = await this.reconcileLatestSnapshot(aggregate);
    const readiness = await this.getInvoiceBillingReadiness(aggregate);
    const previewHtml = this.renderInvoiceHtml(aggregate.payload);

    return {
      ready: aggregate.blockers.length === 0,
      blockers: aggregate.blockers,
      pdf_ready: readiness.pdfBlockers.length === 0,
      pdf_blockers: readiness.pdfBlockers,
      send_ready: readiness.sendBlockers.length === 0,
      send_blockers: readiness.sendBlockers,
      needs_refresh: latestSnapshot?.status === EstimateInvoiceSnapshotStatus.STALE,
      latest_snapshot: latestSnapshot
        ? this.serializeSnapshot(latestSnapshot)
        : null,
      preview: aggregate.payload,
      preview_html: previewHtml,
    };
  }

  async getLatestInvoice(estimateId: string) {
    const aggregate = await this.loadInvoiceAggregate(estimateId);
    const latestSnapshot = await this.reconcileLatestSnapshot(aggregate);
    const readiness = await this.getInvoiceBillingReadiness(aggregate);

    return {
      ready: aggregate.blockers.length === 0,
      blockers: aggregate.blockers,
      pdf_ready: readiness.pdfBlockers.length === 0,
      pdf_blockers: readiness.pdfBlockers,
      send_ready: readiness.sendBlockers.length === 0,
      send_blockers: readiness.sendBlockers,
      needs_refresh: latestSnapshot?.status === EstimateInvoiceSnapshotStatus.STALE,
      snapshot: latestSnapshot ? this.serializeSnapshot(latestSnapshot) : null,
    };
  }

  async getEstimateBillingSummary(
    estimateId: string,
  ): Promise<EstimateInvoiceListSummary> {
    const aggregate = await this.loadInvoiceAggregate(estimateId);
    const latestSnapshot = await this.reconcileLatestSnapshot(aggregate);
    const readiness = await this.getInvoiceBillingReadiness(aggregate);

    return {
      invoice_status: latestSnapshot?.status ?? null,
      latest_invoice_number: latestSnapshot?.invoice_number ?? null,
      invoice_ready: aggregate.blockers.length === 0,
      send_ready: readiness.sendBlockers.length === 0,
      invoice_needs_refresh:
        latestSnapshot?.status === EstimateInvoiceSnapshotStatus.STALE,
    };
  }

  async getEstimateBillingSummariesForList(
    estimates: EstimateBillingSummaryListInput[],
  ): Promise<Map<string, EstimateInvoiceListSummary>> {
    if (estimates.length === 0) {
      return new Map();
    }

    const runtimeReadiness = await this.getGlobalInvoiceRuntimeReadiness();
    const estimateObjectIds = estimates.map((estimate) =>
      asObjectId(estimate.estimate_id, 'estimate id'),
    );
    const customerObjectIds = Array.from(
      new Set(estimates.map((estimate) => estimate.customer_id)),
    ).map((customerId) => asObjectId(customerId, 'customer id'));

    const [customers, latestSnapshots] = await Promise.all([
      this.customerModel
        .find({ _id: { $in: customerObjectIds } })
        .select({ email: 1 })
        .lean()
        .exec(),
      this.estimateInvoiceSnapshotModel
        .aggregate<{
          _id: unknown;
          latestSnapshot: {
            invoice_number: string;
            status: EstimateInvoiceSnapshotStatus;
          };
        }>([
          {
            $match: {
              estimate_id: { $in: estimateObjectIds },
            },
          },
          {
            $sort: {
              estimate_id: 1,
              revision_number: -1,
              created_at: -1,
            },
          },
          {
            $group: {
              _id: '$estimate_id',
              latestSnapshot: { $first: '$$ROOT' },
            },
          },
          {
            $project: {
              latestSnapshot: {
                invoice_number: 1,
                status: 1,
              },
            },
          },
        ])
        .exec(),
    ]);

    const customerEmailById = new Map(
      customers.map((customer) => [
        String(customer._id),
        typeof customer.email === 'string' ? customer.email : null,
      ]),
    );
    const snapshotByEstimateId = new Map(
      latestSnapshots.map((entry) => [String(entry._id), entry.latestSnapshot]),
    );

    return new Map(
      estimates.map((estimate) => {
        const customerEmail =
          customerEmailById.get(estimate.customer_id) ?? null;
        const blockers: string[] = [];

        if (!customerEmail) {
          blockers.push(CUSTOMER_EMAIL_INVOICE_BLOCKER);
        }

        if (estimate.total <= 0 && estimate.services_count === 0) {
          blockers.push(BILLABLE_INVOICE_BLOCKER);
        }
        if (
          estimate.payment_status === PaidStatus.PART_PAID &&
          estimate.amount_paid <= 0
        ) {
          blockers.push(PART_PAID_INVOICE_BLOCKER);
        }

        const latestSnapshot =
          snapshotByEstimateId.get(estimate.estimate_id) ?? null;
        const sendReady =
          blockers.length === 0 && runtimeReadiness.sendBlockers.length === 0;

        return [
          estimate.estimate_id,
          {
            invoice_status: latestSnapshot?.status ?? null,
            latest_invoice_number: latestSnapshot?.invoice_number ?? null,
            invoice_ready: blockers.length === 0,
            send_ready: sendReady,
            invoice_needs_refresh:
              latestSnapshot?.status === EstimateInvoiceSnapshotStatus.STALE,
          },
        ] as const;
      }),
    );
  }

  async isInvoiceSendRuntimeReady() {
    const runtimeReadiness = await this.getGlobalInvoiceRuntimeReadiness();
    return runtimeReadiness.sendBlockers.length === 0;
  }

  async getInvoiceHistory(estimateId: string) {
    const aggregate = await this.loadInvoiceAggregate(estimateId);
    await this.reconcileLatestSnapshot(aggregate);

    const snapshots = await this.estimateInvoiceSnapshotModel
      .find({ estimate_id: aggregate.estimate._id })
      .sort({ revision_number: -1, created_at: -1 })
      .exec();
    const dispatches = await this.estimateInvoiceDispatchModel
      .find({ estimate_id: aggregate.estimate._id })
      .sort({ created_at: -1 })
      .exec();

    return {
      snapshots: snapshots.map((snapshot) => this.serializeSnapshot(snapshot)),
      dispatches: dispatches.map((dispatch) =>
        this.serializeDispatch(dispatch),
      ),
    };
  }

  async getInvoiceHistoryCounts(estimateId: string) {
    const estimateObjectId = asObjectId(estimateId, 'estimate id');
    const [snapshotCount, dispatchCount] = await Promise.all([
      this.estimateInvoiceSnapshotModel.countDocuments({ estimate_id: estimateObjectId }).exec(),
      this.estimateInvoiceDispatchModel.countDocuments({ estimate_id: estimateObjectId }).exec(),
    ]);

    return {
      snapshotCount,
      dispatchCount,
    };
  }

  async deleteInvoiceHistoryForEstimate(
    estimateId: string,
    session?: ClientSession,
  ) {
    const estimateObjectId = asObjectId(estimateId, 'estimate id');
    const options = session ? { session } : undefined;

    await Promise.all([
      this.estimateInvoiceDispatchModel
        .deleteMany({ estimate_id: estimateObjectId }, options)
        .exec(),
      this.estimateInvoiceSnapshotModel
        .deleteMany({ estimate_id: estimateObjectId }, options)
        .exec(),
    ]);
  }

  async issueInvoice(estimateId: string, actorUserId?: string) {
    const aggregate = await this.loadInvoiceAggregate(estimateId);
    const snapshot = await this.resolveIssueableSnapshot(
      aggregate,
      actorUserId,
    );

    return {
      ready: true,
      blockers: [],
      needs_refresh: false,
      snapshot: this.serializeSnapshot(snapshot),
    };
  }

  async sendInvoice(estimateId: string, actorUserId?: string) {
    const aggregate = await this.loadInvoiceAggregate(estimateId);
    const runtimeReadiness = await this.getGlobalInvoiceRuntimeReadiness();
    if (runtimeReadiness.sendBlockers.length > 0) {
      throw new ServiceUnavailableException(
        runtimeReadiness.sendBlockers.join(' '),
      );
    }
    const snapshot = await this.resolveIssueableSnapshot(
      aggregate,
      actorUserId,
    );
    const latestDispatch = await this.getLatestDispatchForSnapshot(snapshot._id);
    if (latestDispatch && this.isRecentDispatch(latestDispatch)) {
      if (latestDispatch.delivery_status === EstimateInvoiceDispatchStatus.PENDING) {
        throw new ConflictException(
          'Invoice sending is already in progress for this revision. Please wait a moment before retrying.',
        );
      }

      if (this.isAcceptedDispatchStatus(latestDispatch.delivery_status)) {
        return {
          ready: true,
          blockers: [],
          needs_refresh: false,
          snapshot: this.serializeSnapshot(snapshot),
          dispatch: this.serializeDispatch(latestDispatch),
        };
      }
    }

    const invoiceProvider = this.getInvoiceProviderName();
    const reusableDispatch = this.canReuseDispatchForIdempotentRetry(
      latestDispatch,
    )
      ? latestDispatch
      : null;
    const dispatch: EstimateInvoiceDispatchDocument = reusableDispatch
      ? reusableDispatch
      : await this.estimateInvoiceDispatchModel.create({
          estimate_id: snapshot.estimate_id,
          invoice_snapshot_id: snapshot._id,
          recipient_email: aggregate.customer.email?.toLowerCase(),
          provider: invoiceProvider,
          provider_message_id: null,
          provider_request_key: this.createInvoiceDispatchRequestKey(
            snapshot._id,
          ),
          delivery_status: EstimateInvoiceDispatchStatus.PENDING,
          error_message: null,
          sent_at: null,
        });

    if (reusableDispatch) {
      dispatch.recipient_email = aggregate.customer.email?.toLowerCase() ?? '';
      dispatch.provider = invoiceProvider;
      dispatch.provider_message_id = null;
      dispatch.provider_request_key =
        dispatch.provider_request_key ??
        this.createInvoiceDispatchRequestKey(snapshot._id);
      dispatch.delivery_status = EstimateInvoiceDispatchStatus.PENDING;
      dispatch.error_message = null;
      dispatch.sent_at = null;
      await dispatch.save();
    }

    try {
      // Sent attachments must render the immutable issued snapshot number.
      const renderPayload = this.serializeSnapshot(snapshot);
      const pdfBytes = await this.renderInvoicePdf(renderPayload);
      const emailMessage = this.toInvoiceEmailMessageModel({
        invoiceNumber: snapshot.invoice_number,
        customerName: aggregate.customer.first_name
          ? `${aggregate.customer.first_name} ${aggregate.customer.last_name}`.trim()
          : renderPayload.customer_snapshot.name,
        estimateNumber: renderPayload.estimate_number_snapshot,
        total: renderPayload.amount_remaining_snapshot,
        dueDate: renderPayload.due_date_snapshot,
        timeZone: renderPayload.time_zone_snapshot,
      });
      const result = await this.sendInvoiceEmail({
        invoiceNumber: snapshot.invoice_number,
        recipientEmail: aggregate.customer.email ?? '',
        html: renderInvoiceEmailMessageHtml(emailMessage),
        text: this.renderInvoiceText({
          invoiceNumber: emailMessage.invoiceNumber,
          customerName: emailMessage.customerName,
          estimateNumber: emailMessage.estimateNumber,
          total: emailMessage.total,
          dueDate: emailMessage.dueDate,
          timeZone: emailMessage.timeZone,
        }),
        pdfBytes,
        idempotencyKey:
          dispatch.provider_request_key ??
          this.createInvoiceDispatchRequestKey(snapshot._id),
      });
      const sentAt = new Date();
      dispatch.provider = result.provider;
      dispatch.provider_message_id = result.providerMessageId;
      dispatch.delivery_status = EstimateInvoiceDispatchStatus.ACCEPTED;
      dispatch.error_message = null;
      dispatch.sent_at = sentAt;
      await dispatch.save();

      snapshot.status = EstimateInvoiceSnapshotStatus.ACCEPTED;
      snapshot.sent_at = sentAt;
      await snapshot.save();

      await this.recordAudit({
        actorUserId,
        entityType: 'estimate',
        entityId: String(snapshot.estimate_id),
        action: 'estimate.invoice.sent',
        before: null,
        after: {
          invoice_number: snapshot.invoice_number,
          revision_number: snapshot.revision_number,
          dispatch_id: String(dispatch._id),
          recipient_email: dispatch.recipient_email,
          provider: dispatch.provider,
        },
      });

      return {
        ready: true,
        blockers: [],
        needs_refresh: false,
        snapshot: this.serializeSnapshot(snapshot),
        dispatch: this.serializeDispatch(dispatch),
      };
    } catch (error) {
      dispatch.provider_message_id = null;
      dispatch.delivery_status = EstimateInvoiceDispatchStatus.FAILED;
      dispatch.error_message = this.asInvoiceErrorMessage(error);
      dispatch.sent_at = null;
      await dispatch.save();

      await this.recordAudit({
        actorUserId,
        entityType: 'estimate',
        entityId: String(snapshot.estimate_id),
        action: 'estimate.invoice.send_failed',
        before: null,
        after: {
          invoice_number: snapshot.invoice_number,
          revision_number: snapshot.revision_number,
          dispatch_id: String(dispatch._id),
          error_message: dispatch.error_message,
        },
      });

      throw new ServiceUnavailableException(dispatch.error_message);
    }
  }

  async getInvoicePdf(estimateId: string) {
    const aggregate = await this.loadInvoiceAggregate(estimateId);
    const runtimeReadiness = await this.getGlobalInvoiceRuntimeReadiness();
    if (runtimeReadiness.pdfBlockers.length > 0) {
      throw new ServiceUnavailableException(
        runtimeReadiness.pdfBlockers.join(' '),
      );
    }
    const snapshot = await this.resolveIssueableSnapshot(aggregate, undefined, {
      blockers: this.getPrintableInvoiceBlockers(aggregate),
    });
    const source = this.serializeSnapshot(snapshot);
    const pdfBytes = await this.renderInvoicePdf(source);

    return {
      fileName: `${snapshot.invoice_number}.pdf`,
      buffer: Buffer.from(pdfBytes),
    };
  }

  async markLatestSnapshotStaleIfNeeded(estimateId: string) {
    const aggregate = await this.loadInvoiceAggregate(estimateId);
    await this.reconcileLatestSnapshot(aggregate);
  }

  private async loadInvoiceAggregate(estimateId: string): Promise<InvoiceAggregate> {
    const estimate = await this.estimateModel
      .findById(asObjectId(estimateId, 'estimate id'))
      .exec();
    if (!estimate) {
      throw new NotFoundException('Estimate not found');
    }

    const [customer, vehicle] = await Promise.all([
      this.customerModel.findById(estimate.customer_id).exec(),
      this.vehicleModel.findById(estimate.vehicle_id).exec(),
    ]);

    if (!customer) {
      throw new NotFoundException('Customer not found');
    }
    if (!vehicle) {
      throw new NotFoundException('Vehicle not found');
    }
    const invoiceTimeZone = await this.resolveInvoiceTimeZone();

    const customerSnapshot: InvoiceCustomerSnapshot = {
      customer_id: String(customer._id),
      name: `${customer.first_name} ${customer.last_name}`.trim(),
      email: customer.email,
      phone: customer.phone,
    };

    const vehicleSnapshot: InvoiceVehicleSnapshot = {
      vehicle_id: String(vehicle._id),
      label: this.toVehicleSnapshotLabel(vehicle),
      vin: vehicle.vin ?? null,
      license_plate: vehicle.license_plate ?? null,
      year: vehicle.year ?? null,
      make: vehicle.make ?? null,
      model: vehicle.model ?? null,
      mileage: vehicle.mileage ?? null,
      mileage_out: vehicle.mileage_out ?? null,
    };

    const servicesSnapshot: InvoiceServiceSnapshot[] = estimate.services.map(
      (service) => ({
        estimate_service_id: String(service._id),
        canned_service_id: service.canned_service_id
          ? String(service.canned_service_id)
          : null,
        name: service.name,
        note: service.note ?? null,
        labor_lines: service.labor_lines.map((line) => ({
          description: line.description,
          hours: line.hours,
          rate: line.rate,
          discount_percent: line.discount_percent,
          subtotal: line.subtotal,
        })),
        part_lines: service.part_lines.map((line) => ({
          name: line.name,
          part_number: line.part_number ?? null,
          quantity: line.quantity,
          cost: line.cost,
          price: line.price,
          discount_percent: line.discount_percent,
          subtotal: line.subtotal,
        })),
        labor_total: service.labor_total,
        parts_total: service.parts_total,
        total: service.total,
      }),
    );

    const estimateTotals = resolveEstimateTotals(
      {
        labor_total:
          typeof estimate.labor_total === 'number' ? estimate.labor_total : 0,
        parts_total:
          typeof estimate.parts_total === 'number' ? estimate.parts_total : 0,
        subtotal:
          typeof estimate.subtotal === 'number' ? estimate.subtotal : undefined,
        tax_rate:
          typeof estimate.tax_rate === 'number' ? estimate.tax_rate : undefined,
        tax_amount:
          typeof estimate.tax_amount === 'number'
            ? estimate.tax_amount
            : undefined,
        total: typeof estimate.total === 'number' ? estimate.total : undefined,
      },
      { applyDefaultTaxWhenMissing: true },
    );
    const total = estimateTotals.total;
    const paymentState = resolveEstimatePaymentState({
      amount_paid: estimate.amount_paid,
      total,
      payment_status: estimate.payment_status,
    });
    const paymentStatus = this.resolvePaymentStatusFromBalance(
      total,
      paymentState.amount_paid,
      estimate.payment_status,
    );

    const payload: InvoiceDocumentPayload = {
      estimate_id: String(estimate._id),
      estimate_number_snapshot: estimate.estimate_number,
      title_snapshot: estimate.title,
      time_zone_snapshot: invoiceTimeZone,
      complaint_or_request_snapshot: normalizeInvoiceOptionalText(
        estimate.complaint_or_request,
      ),
      recommendation_snapshot: normalizeInvoiceOptionalText(estimate.notes),
      customer_snapshot: customerSnapshot,
      vehicle_snapshot: vehicleSnapshot,
      services_snapshot: servicesSnapshot,
      subtotal_snapshot: estimateTotals.subtotal,
      tax_rate_snapshot: estimateTotals.tax_rate,
      tax_amount_snapshot: estimateTotals.tax_amount,
      total,
      amount_paid_snapshot: paymentState.amount_paid,
      amount_remaining_snapshot: paymentState.amount_remaining,
      payment_status_snapshot: paymentStatus,
      payment_type_snapshot: estimate.payment_type,
      due_date_snapshot: estimate.due_date ? estimate.due_date.toISOString() : null,
      scheduled_start_snapshot: estimate.scheduled_start
        ? estimate.scheduled_start.toISOString()
        : null,
      scheduled_end_snapshot: estimate.scheduled_end
        ? estimate.scheduled_end.toISOString()
        : null,
      generated_at: new Date().toISOString(),
    };

    const blockers: string[] = [];
    if (!customer.email) {
      blockers.push(CUSTOMER_EMAIL_INVOICE_BLOCKER);
    }
    if (payload.total <= 0 && servicesSnapshot.length === 0) {
      blockers.push(BILLABLE_INVOICE_BLOCKER);
    }
    if (
      payload.payment_status_snapshot === PaidStatus.PART_PAID &&
      payload.amount_paid_snapshot <= 0
    ) {
      blockers.push(PART_PAID_INVOICE_BLOCKER);
    }

    return {
      estimate,
      customer,
      vehicle,
      payload,
      blockers,
      billableHash: this.buildBillableHash(payload),
    };
  }

  private async resolveInvoiceTimeZone() {
    const defaultTimeZone = this.getDefaultInvoiceTimeZone();
    const appSettings = await this.appSettingsModel
      .findOne({ singleton_key: 'app' })
      .select({ business_timezone: 1 })
      .lean()
      .exec()
      .catch(() => null);

    const storedTimeZone = appSettings?.business_timezone;
    return typeof storedTimeZone === 'string' &&
      this.isValidTimeZone(storedTimeZone)
      ? storedTimeZone
      : defaultTimeZone;
  }

  private getDefaultInvoiceTimeZone() {
    const configured =
      this.configService.get<string>('BUSINESS_TIMEZONE') ?? 'America/New_York';
    return this.isValidTimeZone(configured) ? configured : 'America/New_York';
  }

  private isValidTimeZone(value: string) {
    try {
      new Intl.DateTimeFormat('en-US', { timeZone: value }).format(new Date());
      return true;
    } catch {
      return false;
    }
  }

  private buildBillableHash(payload: InvoiceDocumentPayload) {
    return JSON.stringify({
      estimate_number_snapshot: payload.estimate_number_snapshot,
      title_snapshot: payload.title_snapshot,
      time_zone_snapshot: payload.time_zone_snapshot,
      complaint_or_request_snapshot: payload.complaint_or_request_snapshot,
      recommendation_snapshot: payload.recommendation_snapshot,
      customer_snapshot: payload.customer_snapshot,
      vehicle_snapshot: payload.vehicle_snapshot,
      services_snapshot: payload.services_snapshot,
      subtotal_snapshot: payload.subtotal_snapshot,
      tax_rate_snapshot: payload.tax_rate_snapshot,
      tax_amount_snapshot: payload.tax_amount_snapshot,
      total: payload.total,
      amount_paid_snapshot: payload.amount_paid_snapshot,
      amount_remaining_snapshot: payload.amount_remaining_snapshot,
      payment_status_snapshot: payload.payment_status_snapshot,
      payment_type_snapshot: payload.payment_type_snapshot,
      due_date_snapshot: payload.due_date_snapshot,
      scheduled_start_snapshot: payload.scheduled_start_snapshot,
      scheduled_end_snapshot: payload.scheduled_end_snapshot,
    });
  }

  private snapshotNumberMatches(
    actual: number | undefined,
    expected: number,
    precision = 2,
  ) {
    if (typeof actual !== 'number' || !Number.isFinite(actual)) {
      return false;
    }

    return actual.toFixed(precision) === expected.toFixed(precision);
  }

  private resolvePaymentStatusFromBalance(
    total: number,
    amountPaid: number,
    currentStatus?: PaidStatus,
  ) {
    if (
      currentStatus === PaidStatus.PART_PAID &&
      amountPaid <= 0 &&
      total > 0
    ) {
      return PaidStatus.PART_PAID;
    }

    const amountRemaining = resolveEstimatePaymentState({
      amount_paid: amountPaid,
      total,
    }).amount_remaining;
    if (amountRemaining === 0 && total > 0) {
      return PaidStatus.PAID;
    }
    if (amountPaid > 0) {
      return PaidStatus.PART_PAID;
    }
    return PaidStatus.UNPAID;
  }

  private isSnapshotFinanciallySynced(
    snapshot: EstimateInvoiceSnapshotDocument,
    payload: InvoiceDocumentPayload,
  ) {
    return (
      this.snapshotNumberMatches(
        snapshot.subtotal_snapshot,
        payload.subtotal_snapshot,
      ) &&
      this.snapshotNumberMatches(
        snapshot.tax_rate_snapshot,
        payload.tax_rate_snapshot,
        3,
      ) &&
      this.snapshotNumberMatches(
        snapshot.tax_amount_snapshot,
        payload.tax_amount_snapshot,
      ) &&
      this.snapshotNumberMatches(snapshot.total, payload.total) &&
      this.snapshotNumberMatches(
        snapshot.amount_paid_snapshot,
        payload.amount_paid_snapshot,
      ) &&
      this.snapshotNumberMatches(
        snapshot.amount_remaining_snapshot,
        payload.amount_remaining_snapshot,
      )
    );
  }

  private async reconcileLatestSnapshot(aggregate: InvoiceAggregate) {
    const latestSnapshot = await this.estimateInvoiceSnapshotModel
      .findOne({ estimate_id: aggregate.estimate._id })
      .sort({ revision_number: -1, created_at: -1 })
      .exec();

    if (!latestSnapshot) {
      return null;
    }

    const isBillableSnapshot =
      latestSnapshot.status === EstimateInvoiceSnapshotStatus.ISSUED ||
      latestSnapshot.status === EstimateInvoiceSnapshotStatus.ACCEPTED ||
      latestSnapshot.status === EstimateInvoiceSnapshotStatus.SENT;

    if (
      isBillableSnapshot &&
      (latestSnapshot.billable_hash !== aggregate.billableHash ||
        !this.isSnapshotFinanciallySynced(latestSnapshot, aggregate.payload))
    ) {
      latestSnapshot.status = EstimateInvoiceSnapshotStatus.STALE;
      latestSnapshot.stale_at = new Date();
      await latestSnapshot.save();
    }

    return latestSnapshot;
  }

  private async resolveIssueableSnapshot(
    aggregate: InvoiceAggregate,
    actorUserId?: string,
    options?: { blockers?: string[] },
  ) {
    const blockers = options?.blockers ?? aggregate.blockers;
    if (blockers.length > 0) {
      throw new BadRequestException(blockers.join(' '));
    }

    const latestSnapshot = await this.reconcileLatestSnapshot(aggregate);
    if (
      latestSnapshot &&
      latestSnapshot.status !== EstimateInvoiceSnapshotStatus.STALE &&
      latestSnapshot.status !== EstimateInvoiceSnapshotStatus.VOID &&
      latestSnapshot.billable_hash === aggregate.billableHash &&
      this.isSnapshotFinanciallySynced(latestSnapshot, aggregate.payload)
    ) {
      return latestSnapshot;
    }

    const snapshot = await this.createSnapshot(aggregate);

    if (latestSnapshot) {
      latestSnapshot.superseded_by_snapshot_id = snapshot._id;
      await latestSnapshot.save();
    }

    await this.recordAudit({
      actorUserId,
      entityType: 'estimate',
      entityId: String(aggregate.estimate._id),
      action: 'estimate.invoice.issued',
      before: null,
      after: {
        invoice_number: snapshot.invoice_number,
        revision_number: snapshot.revision_number,
        status: snapshot.status,
      },
    });

    return snapshot;
  }

  private async createSnapshot(aggregate: InvoiceAggregate) {
    const maxAttempts = 5;
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      try {
        const latestSnapshot = await this.estimateInvoiceSnapshotModel
          .findOne({ estimate_id: aggregate.estimate._id })
          .sort({ revision_number: -1, created_at: -1 })
          .exec();
        const revisionNumber = latestSnapshot
          ? latestSnapshot.revision_number + 1
          : 1;
        const invoiceNumber = this.getInvoiceSnapshotNumber(
          aggregate.payload.estimate_number_snapshot,
          revisionNumber,
        );
        return await this.estimateInvoiceSnapshotModel.create({
          estimate_id: aggregate.estimate._id,
          invoice_number: invoiceNumber,
          revision_number: revisionNumber,
          status: EstimateInvoiceSnapshotStatus.ISSUED,
          customer_snapshot: aggregate.payload.customer_snapshot,
          vehicle_snapshot: aggregate.payload.vehicle_snapshot,
          services_snapshot: aggregate.payload.services_snapshot,
          estimate_number_snapshot: aggregate.payload.estimate_number_snapshot,
          title_snapshot: aggregate.payload.title_snapshot,
          time_zone_snapshot: aggregate.payload.time_zone_snapshot,
          complaint_or_request_snapshot:
            aggregate.payload.complaint_or_request_snapshot,
          recommendation_snapshot: aggregate.payload.recommendation_snapshot,
          subtotal_snapshot: aggregate.payload.subtotal_snapshot,
          tax_rate_snapshot: aggregate.payload.tax_rate_snapshot,
          tax_amount_snapshot: aggregate.payload.tax_amount_snapshot,
          total: aggregate.payload.total,
          amount_paid_snapshot: aggregate.payload.amount_paid_snapshot,
          amount_remaining_snapshot: aggregate.payload.amount_remaining_snapshot,
          payment_status_snapshot: aggregate.payload.payment_status_snapshot,
          payment_type_snapshot: aggregate.payload.payment_type_snapshot,
          due_date_snapshot: aggregate.payload.due_date_snapshot
            ? new Date(aggregate.payload.due_date_snapshot)
            : null,
          scheduled_start_snapshot: aggregate.payload.scheduled_start_snapshot
            ? new Date(aggregate.payload.scheduled_start_snapshot)
            : null,
          scheduled_end_snapshot: aggregate.payload.scheduled_end_snapshot
            ? new Date(aggregate.payload.scheduled_end_snapshot)
            : null,
          billable_hash: aggregate.billableHash,
          issued_at: new Date(),
          sent_at: null,
          stale_at: null,
          superseded_by_snapshot_id: null,
        });
      } catch (error) {
        if (
          (error as { code?: number }).code === 11000 &&
          attempt < maxAttempts
        ) {
          continue;
        }
        throw error;
      }
    }

    throw new ServiceUnavailableException(
      'Could not generate a unique invoice number. Please retry.',
    );
  }

  private getInvoiceSnapshotNumber(
    estimateNumber: string,
    revisionNumber: number,
  ) {
    const baseNumber = estimateNumber.trim().toUpperCase();
    return revisionNumber === 1
      ? baseNumber
      : `${baseNumber}-R${revisionNumber}`;
  }

  private serializeSnapshot(
    snapshot: EstimateInvoiceSnapshotDocument,
  ): SerializedInvoiceSnapshot {
    const raw = snapshot.toObject() as unknown as {
      _id: unknown;
      estimate_id: unknown;
      invoice_number: string;
      revision_number: number;
      status: EstimateInvoiceSnapshotStatus;
      customer_snapshot: InvoiceCustomerSnapshot;
      vehicle_snapshot: InvoiceVehicleSnapshot;
      services_snapshot: InvoiceServiceSnapshot[];
      estimate_number_snapshot: string;
      title_snapshot: string;
      time_zone_snapshot: string | null;
      complaint_or_request_snapshot: string | null;
      recommendation_snapshot: string | null;
      subtotal_snapshot?: number;
      tax_rate_snapshot?: number;
      tax_amount_snapshot?: number;
      total: number;
      amount_paid_snapshot: number;
      amount_remaining_snapshot: number;
      payment_status_snapshot: PaidStatus;
      payment_type_snapshot: string;
      due_date_snapshot: Date | string | null;
      scheduled_start_snapshot: Date | string | null;
      scheduled_end_snapshot: Date | string | null;
      billable_hash: string;
      issued_at: Date | string | null;
      sent_at: Date | string | null;
      stale_at: Date | string | null;
      superseded_by_snapshot_id: unknown | null;
      created_at: Date | string | null;
      updated_at: Date | string | null;
    };

    const servicesSnapshot = raw.services_snapshot as InvoiceServiceSnapshot[];
    const snapshotSubtotal = servicesSnapshot.reduce(
      (sum, service) => sum + (typeof service.total === 'number' ? service.total : 0),
      0,
    );
    const resolvedTotals = resolveEstimateTotals({
      labor_total: servicesSnapshot.reduce(
        (sum, service) =>
          sum + (typeof service.labor_total === 'number' ? service.labor_total : 0),
        0,
      ),
      parts_total: servicesSnapshot.reduce(
        (sum, service) =>
          sum + (typeof service.parts_total === 'number' ? service.parts_total : 0),
        0,
      ),
      subtotal:
        typeof raw.subtotal_snapshot === 'number'
          ? raw.subtotal_snapshot
          : snapshotSubtotal,
      tax_rate:
        typeof raw.tax_rate_snapshot === 'number'
          ? raw.tax_rate_snapshot
          : undefined,
      tax_amount:
        typeof raw.tax_amount_snapshot === 'number'
          ? raw.tax_amount_snapshot
          : undefined,
      total: raw.total,
    });
    const paymentState = resolveEstimatePaymentState({
      amount_paid:
        typeof raw.amount_paid_snapshot === 'number'
          ? raw.amount_paid_snapshot
          : undefined,
      total: resolvedTotals.total,
      payment_status: raw.payment_status_snapshot,
    });
    const paymentStatus = this.resolvePaymentStatusFromBalance(
      resolvedTotals.total,
      paymentState.amount_paid,
      raw.payment_status_snapshot,
    );

    return {
      id: String(raw._id),
      estimate_id: String(raw.estimate_id),
      invoice_number: raw.invoice_number,
      revision_number: raw.revision_number,
      status: raw.status,
      billable_hash: raw.billable_hash,
      estimate_number_snapshot: raw.estimate_number_snapshot,
      title_snapshot: raw.title_snapshot,
      complaint_or_request_snapshot: normalizeInvoiceOptionalText(
        raw.complaint_or_request_snapshot,
      ),
      recommendation_snapshot: normalizeInvoiceOptionalText(
        raw.recommendation_snapshot,
      ),
      customer_snapshot: raw.customer_snapshot as InvoiceCustomerSnapshot,
      vehicle_snapshot: raw.vehicle_snapshot as InvoiceVehicleSnapshot,
      services_snapshot: servicesSnapshot,
      subtotal_snapshot: resolvedTotals.subtotal,
      tax_rate_snapshot: resolvedTotals.tax_rate,
      tax_amount_snapshot: resolvedTotals.tax_amount,
      total: resolvedTotals.total,
      amount_paid_snapshot: paymentState.amount_paid,
      amount_remaining_snapshot: paymentState.amount_remaining,
      payment_status_snapshot: paymentStatus,
      payment_type_snapshot: raw.payment_type_snapshot,
      time_zone_snapshot:
        typeof raw.time_zone_snapshot === 'string'
          ? raw.time_zone_snapshot
          : this.getDefaultInvoiceTimeZone(),
      superseded_by_snapshot_id: raw.superseded_by_snapshot_id
        ? String(raw.superseded_by_snapshot_id)
        : null,
      due_date_snapshot: raw.due_date_snapshot
        ? new Date(raw.due_date_snapshot).toISOString()
        : null,
      scheduled_start_snapshot: raw.scheduled_start_snapshot
        ? new Date(raw.scheduled_start_snapshot).toISOString()
        : null,
      scheduled_end_snapshot: raw.scheduled_end_snapshot
        ? new Date(raw.scheduled_end_snapshot).toISOString()
        : null,
      issued_at: raw.issued_at ? new Date(raw.issued_at).toISOString() : null,
      sent_at: raw.sent_at ? new Date(raw.sent_at).toISOString() : null,
      stale_at: raw.stale_at ? new Date(raw.stale_at).toISOString() : null,
      generated_at: raw.updated_at
        ? new Date(raw.updated_at).toISOString()
        : new Date().toISOString(),
      created_at: raw.created_at
        ? new Date(raw.created_at).toISOString()
        : null,
      updated_at: raw.updated_at
        ? new Date(raw.updated_at).toISOString()
        : null,
    };
  }

  private serializeDispatch(
    dispatch: EstimateInvoiceDispatchDocument,
  ): SerializedInvoiceDispatch {
    const raw = dispatch.toObject() as unknown as {
      _id: unknown;
      estimate_id: unknown;
      invoice_snapshot_id: unknown;
      recipient_email: string;
      provider: string;
      provider_message_id: string | null;
      delivery_status: EstimateInvoiceDispatchStatus;
      error_message: string | null;
      sent_at: Date | string | null;
      created_at: Date | string | null;
      updated_at: Date | string | null;
    };

    return {
      id: String(raw._id),
      estimate_id: String(raw.estimate_id),
      invoice_snapshot_id: String(raw.invoice_snapshot_id),
      recipient_email: raw.recipient_email,
      provider: raw.provider,
      provider_message_id: raw.provider_message_id,
      delivery_status: raw.delivery_status,
      error_message: raw.error_message,
      sent_at: raw.sent_at ? new Date(raw.sent_at).toISOString() : null,
      created_at: raw.created_at
        ? new Date(raw.created_at).toISOString()
        : null,
      updated_at: raw.updated_at
        ? new Date(raw.updated_at).toISOString()
        : null,
    };
  }

  private sendInvoiceEmail(input: {
    invoiceNumber: string;
    recipientEmail: string;
    html: string;
    text: string;
    pdfBytes: Uint8Array;
    idempotencyKey: string;
  }): Promise<InvoiceEmailResult> {
    const normalizedTransport = this.getInvoiceEmailTransport();
    const fromAddress =
      this.configService.get<string>('INVOICE_EMAIL_FROM') ??
      'billing@rico.local';

    if (normalizedTransport === 'DISABLED') {
      throw new ServiceUnavailableException(
        'Invoice email transport is disabled. Configure a delivery transport before sending invoices.',
      );
    }

    if (normalizedTransport === 'LOG') {
      const messageId = `log-${generateOrderId()}`;
      this.logger.log(
        `Invoice email captured via ${normalizedTransport} transport | from=${fromAddress} | to=${input.recipientEmail} | invoice=${input.invoiceNumber} | messageId=${messageId}`,
      );
      this.logger.debug(input.html);

      throw new ServiceUnavailableException(
        'Invoice email transport is in log-only mode. Review backend logs; delivery was not attempted.',
      );
    }

    if (normalizedTransport === 'RESEND') {
      return this.getResendClient()
        .emails.send({
          from: fromAddress,
          to: [input.recipientEmail],
          subject: `Invoice ${input.invoiceNumber} from Gmb Workshop`,
          html: input.html,
          text: input.text,
          attachments: [
            {
              filename: `${input.invoiceNumber}.pdf`,
              content: Buffer.from(input.pdfBytes),
              contentType: 'application/pdf',
            },
            {
              filename: 'invoice-logo.jpg',
              content: INVOICE_LOGO_BUFFER,
              contentType: 'image/jpeg',
              contentId: INVOICE_LOGO_CONTENT_ID,
            },
          ],
        }, {
          idempotencyKey: input.idempotencyKey,
        })
        .then((result) => {
          if (result.error) {
            throw new ServiceUnavailableException(result.error.message);
          }

          return {
            provider: 'resend',
            providerMessageId: result.data?.id ?? `resend-${generateOrderId()}`,
          };
        });
    }

    throw new ServiceUnavailableException(
      'Invoice email transport is not configured for delivery. Configure Resend before sending invoices.',
    );
  }

  private renderInvoiceText(input: {
    invoiceNumber: string;
    customerName: string;
    estimateNumber: string;
    total: number;
    dueDate: string | null;
    timeZone: string;
  }) {
    const customerName = input.customerName.trim() || 'Customer';
    const dueDate = this.formatInvoiceDate(input.dueDate, input.timeZone);

    return [
      `Dear ${customerName},`,
      '',
      'Thank you for your business.',
      '',
      `Attached to this email is your invoice ${input.invoiceNumber} for estimate ${input.estimateNumber}.`,
      '',
      `Amount due: ${this.formatInvoiceCurrency(input.total)}`,
      `Due date: ${dueDate}`,
      '',
      'Please open the attached PDF to review the complete invoice details.',
      '',
      'If you have any questions, please contact us and we will be happy to assist.',
      '',
      'Kind regards,',
      'Gmb Workshop',
    ].join('\n');
  }

  private getInvoiceDocumentLabel(invoice: InvoiceRenderPayload) {
    return 'invoice_number' in invoice && invoice.invoice_number
      ? invoice.invoice_number
      : invoice.estimate_number_snapshot;
  }

  private getInvoiceServiceRows(invoice: InvoiceRenderPayload) {
    return invoice.services_snapshot.map((line) => ({
      name: line.name,
      note: line.note,
      laborTotal: line.labor_total,
      partsTotal: line.parts_total,
      total: line.total,
      laborLines: line.labor_lines.map((laborLine) => ({
        description: laborLine.description,
        hours: laborLine.hours,
        rate: laborLine.rate,
        subTotal: laborLine.subtotal,
      })),
      partLines: line.part_lines.map((partLine) => ({
        description: partLine.name,
        partNumber: partLine.part_number,
        quantity: partLine.quantity,
        price: partLine.price,
        subTotal: partLine.subtotal,
      })),
    }));
  }

  private toInvoiceDocumentModel(
    invoice: InvoiceRenderPayload,
  ): InvoiceDocumentModel {
    return {
      invoiceNumber: this.getInvoiceDocumentLabel(invoice),
      estimateNumber: invoice.estimate_number_snapshot,
      title: invoice.title_snapshot,
      timeZone: invoice.time_zone_snapshot,
      customerComment: invoice.complaint_or_request_snapshot ?? null,
      recommendation: invoice.recommendation_snapshot ?? null,
      customerName: invoice.customer_snapshot.name,
      customerEmail: invoice.customer_snapshot.email,
      customerPhone: invoice.customer_snapshot.phone,
      vehicleLabel: invoice.vehicle_snapshot.label,
      vehicleVin: invoice.vehicle_snapshot.vin ?? 'Not recorded',
      vehiclePlate: invoice.vehicle_snapshot.license_plate ?? 'Not recorded',
      vehicleYear:
        typeof invoice.vehicle_snapshot.year === 'number'
          ? invoice.vehicle_snapshot.year
          : null,
      vehicleMake:
        typeof invoice.vehicle_snapshot.make === 'string'
          ? invoice.vehicle_snapshot.make
          : null,
      vehicleModel:
        typeof invoice.vehicle_snapshot.model === 'string'
          ? invoice.vehicle_snapshot.model
          : null,
      vehicleMileage:
        typeof invoice.vehicle_snapshot.mileage === 'number'
          ? invoice.vehicle_snapshot.mileage
          : null,
      vehicleMileageOut:
        typeof invoice.vehicle_snapshot.mileage_out === 'number'
          ? invoice.vehicle_snapshot.mileage_out
          : null,
      dueDate: invoice.due_date_snapshot,
      generatedAt: invoice.generated_at,
      paymentStatus: invoice.payment_status_snapshot,
      paymentType: invoice.payment_type_snapshot,
      subTotal: invoice.subtotal_snapshot,
      taxRate: invoice.tax_rate_snapshot,
      taxAmount: invoice.tax_amount_snapshot,
      total: invoice.total,
      amountPaid: invoice.amount_paid_snapshot,
      amountRemaining: invoice.amount_remaining_snapshot,
      services: this.getInvoiceServiceRows(invoice),
      mode:
        'invoice_number' in invoice && invoice.invoice_number
          ? 'issued'
          : 'preview',
    };
  }

  private toInvoiceEmailMessageModel(input: {
    invoiceNumber: string;
    customerName: string;
    estimateNumber: string;
    total: number;
    dueDate: string | null;
    timeZone: string;
  }): InvoiceEmailMessageModel {
    return {
      invoiceNumber: input.invoiceNumber,
      customerName: input.customerName,
      estimateNumber: input.estimateNumber,
      total: input.total,
      dueDate: input.dueDate,
      timeZone: input.timeZone,
    };
  }

  private toVehicleSnapshotLabel(vehicle: VehicleDocument) {
    return `${vehicle.license_plate ?? 'No plate'} · ${vehicle.make} ${vehicle.model}`;
  }

  private formatInvoiceDate(value: string | null, timeZone: string) {
    if (!value) {
      return 'Not set';
    }

    return new Intl.DateTimeFormat('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      timeZone,
    }).format(new Date(value));
  }

  private formatInvoiceCurrency(value: number) {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
    }).format(value);
  }

  private renderInvoiceHtml(invoice: InvoiceRenderPayload) {
    return renderInvoiceDocumentHtml(this.toInvoiceDocumentModel(invoice));
  }

  private async getLatestDispatchForSnapshot(snapshotId: EstimateInvoiceSnapshotDocument['_id']) {
    return this.estimateInvoiceDispatchModel
      .findOne({ invoice_snapshot_id: snapshotId })
      .sort({ created_at: -1 })
      .exec();
  }

  private createInvoiceDispatchRequestKey(
    snapshotId: EstimateInvoiceSnapshotDocument['_id'],
  ) {
    return `invoice:${String(snapshotId)}:${generateOrderId()}`;
  }

  private isRecentDispatch(dispatch: Pick<EstimateInvoiceDispatchDocument, 'created_at' | 'updated_at'>) {
    const relevantDate = dispatch.created_at ?? dispatch.updated_at;
    if (!(relevantDate instanceof Date)) {
      return false;
    }

    return Date.now() - relevantDate.getTime() < RECENT_INVOICE_DISPATCH_WINDOW_MS;
  }

  private isAcceptedDispatchStatus(status: EstimateInvoiceDispatchStatus) {
    return (
      status === EstimateInvoiceDispatchStatus.ACCEPTED ||
      status === EstimateInvoiceDispatchStatus.SENT
    );
  }

  private canReuseDispatchForIdempotentRetry(
    dispatch: EstimateInvoiceDispatchDocument | null,
  ) {
    return Boolean(
      dispatch &&
        this.isRecentDispatch(dispatch) &&
        dispatch.delivery_status === EstimateInvoiceDispatchStatus.FAILED &&
        this.isIndeterminateDispatchError(dispatch.error_message),
    );
  }

  private isIndeterminateDispatchError(message: string | null | undefined) {
    if (!message) {
      return false;
    }

    return (
      /unable to fetch data/i.test(message) ||
      /request could not be resolved/i.test(message) ||
      /fetch failed/i.test(message) ||
      /timeout/i.test(message) ||
      /timed out/i.test(message)
    );
  }

  private async getPdfBrowser() {
    if (!this.pdfBrowserPromise) {
      const executablePath = this.resolvePdfBrowserExecutablePath();
      const browserPromise = puppeteer
        .launch({
          headless: true,
          ...(executablePath ? { executablePath } : {}),
          args: ['--no-sandbox', '--disable-setuid-sandbox'],
        })
        .then((browser) => {
          browser.once('disconnected', () => {
            if (this.pdfBrowserPromise === browserPromise) {
              this.pdfBrowserPromise = null;
            }
          });

          return browser;
        })
        .catch((error: unknown) => {
          if (this.pdfBrowserPromise === browserPromise) {
            this.pdfBrowserPromise = null;
          }
          throw error;
        });

      this.pdfBrowserPromise = browserPromise;
    }

    return this.pdfBrowserPromise;
  }

  private resolvePdfBrowserExecutablePath() {
    const configuredPath =
      process.env.PUPPETEER_EXECUTABLE_PATH ||
      process.env.CHROME_BIN ||
      process.env.GOOGLE_CHROME_BIN;

    if (configuredPath && existsSync(configuredPath)) {
      return configuredPath;
    }

    return PDF_BROWSER_EXECUTABLE_CANDIDATES.find((candidate) =>
      existsSync(candidate),
    );
  }

  private async resetPdfBrowser() {
    const browserPromise = this.pdfBrowserPromise;
    this.pdfBrowserPromise = null;

    if (!browserPromise) {
      return;
    }

    const browser = await browserPromise.catch(() => null);
    if (browser) {
      await browser.close().catch(() => undefined);
    }
  }

  private async getPdfBlockers() {
    try {
      const browser = await this.getPdfBrowser();
      const page = await browser.newPage();
      await page.close().catch(() => undefined);
      return [] as string[];
    } catch {
      await this.resetPdfBrowser();
      return [
        'Invoice PDF rendering is unavailable. Verify the bundled Chromium runtime before sending or downloading invoices.',
      ];
    }
  }

  private async getGlobalInvoiceRuntimeReadiness() {
    const now = Date.now();
    if (
      this.invoiceRuntimeReadinessPromise &&
      now < this.invoiceRuntimeReadinessExpiresAt
    ) {
      return this.invoiceRuntimeReadinessPromise;
    }

    const readinessPromise = (async () => {
      const transportBlockers = this.getTransportRuntimeBlockers();
      const pdfBlockers = await this.getPdfBlockers();

      return {
        pdfBlockers,
        sendBlockers: Array.from(
          new Set([...transportBlockers, ...pdfBlockers]),
        ),
      };
    })();

    this.invoiceRuntimeReadinessPromise = readinessPromise;
    this.invoiceRuntimeReadinessExpiresAt = now + 30_000;

    try {
      return await readinessPromise;
    } catch (error) {
      if (this.invoiceRuntimeReadinessPromise === readinessPromise) {
        this.invoiceRuntimeReadinessPromise = null;
        this.invoiceRuntimeReadinessExpiresAt = 0;
      }
      throw error;
    }
  }

  private async getInvoiceBillingReadiness(
    aggregate: InvoiceAggregate,
  ): Promise<InvoiceBillingReadiness> {
    const runtimeReadiness = await this.getGlobalInvoiceRuntimeReadiness();
    const aggregateBlockers = [...aggregate.blockers];
    const printableBlockers = this.getPrintableInvoiceBlockers(aggregate);

    return {
      pdfBlockers: Array.from(
        new Set([...printableBlockers, ...runtimeReadiness.pdfBlockers]),
      ),
      sendBlockers: Array.from(
        new Set([...aggregateBlockers, ...runtimeReadiness.sendBlockers]),
      ),
    };
  }

  private getPrintableInvoiceBlockers(aggregate: InvoiceAggregate) {
    return aggregate.blockers.filter(
      (blocker) => blocker !== CUSTOMER_EMAIL_INVOICE_BLOCKER,
    );
  }

  private async renderInvoicePdf(invoice: InvoiceRenderPayload) {
    const html = this.renderInvoiceHtml(invoice);

    try {
      const browser = await this.getPdfBrowser();
      const page = await browser.newPage();

      try {
        await page.setViewport({
          width: 1280,
          height: 1600,
          deviceScaleFactor: 1,
        });
        await page.setContent(html, {
          waitUntil: ['domcontentloaded', 'load', 'networkidle0'],
        });
        if (typeof page.waitForFunction === 'function') {
          await page
            .waitForFunction(
              () =>
                Array.from(document.images).every(
                  (image) =>
                    image.complete &&
                    typeof image.naturalWidth === 'number' &&
                    image.naturalWidth > 0,
                ),
              { timeout: 10_000 },
            )
            .catch(() => undefined);
        }

        const pdfBytes = await page.pdf({
          format: 'Letter',
          printBackground: true,
          preferCSSPageSize: true,
        });

        return new Uint8Array(pdfBytes);
      } finally {
        await page.close().catch(() => undefined);
      }
    } catch (error) {
      await this.resetPdfBrowser();
      this.logger.error('Failed to render invoice PDF from HTML', error);
      throw new ServiceUnavailableException(
        'PDF rendering is unavailable at the moment.',
      );
    }
  }

  private getTransportRuntimeBlockers() {
    const blockers: string[] = [];
    const transport = this.getInvoiceEmailTransport();

    if (transport === 'DISABLED') {
      blockers.push(
        'Invoice email transport is disabled. Configure a delivery transport before sending invoices.',
      );
    }

    if (transport === 'LOG') {
      blockers.push(
        'Invoice email transport is in log-only mode. Review backend logs or configure a real delivery transport before sending invoices.',
      );
    }

    if (transport === 'RESEND') {
      blockers.push(...this.getResendRuntimeBlockers());
    }

    return blockers;
  }

  private getResendRuntimeBlockers() {
    const blockers: string[] = [];
    const apiKey = this.configService.get<string>(
      'INVOICE_EMAIL_RESEND_API_KEY',
    );
    if (!apiKey) {
      blockers.push(
        'Invoice Resend transport is incomplete. Configure INVOICE_EMAIL_RESEND_API_KEY before sending invoices.',
      );
      return blockers;
    }

    const fromValue = this.configService.get<string>('INVOICE_EMAIL_FROM');
    const fromAddress = this.extractMailboxAddress(fromValue);

    if (!fromAddress) {
      blockers.push(
        'Invoice Resend transport is incomplete. Configure INVOICE_EMAIL_FROM with a verified sender address before sending invoices.',
      );
      return blockers;
    }

    const fromDomain = fromAddress.split('@')[1]?.toLowerCase();
    if (!fromDomain) {
      blockers.push(
        'Invoice Resend transport is incomplete. Configure INVOICE_EMAIL_FROM with a valid sender address before sending invoices.',
      );
      return blockers;
    }

    if (PUBLIC_MAILBOX_DOMAINS.has(fromDomain)) {
      blockers.push(
        `Invoice Resend transport requires a sender address on your verified domain. ${fromAddress} uses ${fromDomain}, which Resend will reject for this setup.`,
      );
      return blockers;
    }

    return blockers;
  }

  private getInvoiceEmailTransport(): InvoiceEmailTransport {
    const transport = this.configService.get<string>('INVOICE_EMAIL_TRANSPORT');
    const normalized = transport?.toUpperCase();

    if (normalized === 'RESEND') {
      return 'RESEND';
    }
    if (normalized === 'LOG') {
      return 'LOG';
    }
    return 'DISABLED';
  }

  private getInvoiceProviderName() {
    const transport = this.getInvoiceEmailTransport();

    if (transport === 'RESEND') {
      return 'resend';
    }

    return transport.toLowerCase();
  }

  private getResendClient() {
    if (this.resendClient) {
      return this.resendClient;
    }

    const apiKey = this.configService.get<string>(
      'INVOICE_EMAIL_RESEND_API_KEY',
    );
    if (!apiKey) {
      throw new ServiceUnavailableException(
        'Invoice Resend transport is incomplete. Configure INVOICE_EMAIL_RESEND_API_KEY before sending invoices.',
      );
    }

    this.resendClient = new Resend(apiKey);
    return this.resendClient;
  }

  private extractMailboxAddress(value?: string | null) {
    if (!value) {
      return null;
    }

    const trimmed = value.trim();
    const bareEmailPattern = /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/;
    if (bareEmailPattern.test(trimmed)) {
      return trimmed.toLowerCase();
    }

    const namedEmailMatch = trimmed.match(
      /^.+?\s*<\s*([^\s@<>]+@[^\s@<>]+\.[^\s@<>]+)\s*>$/,
    );
    if (!namedEmailMatch) {
      return null;
    }

    return namedEmailMatch[1].toLowerCase();
  }

  private asInvoiceErrorMessage(error: unknown) {
    const message =
      error &&
      typeof error === 'object' &&
      'message' in error &&
      typeof error.message === 'string'
        ? error.message.trim()
        : '';

    if (
      /unable to fetch data/i.test(message) ||
      /request could not be resolved/i.test(message) ||
      /fetch failed/i.test(message)
    ) {
      return 'Invoice sending could not reach Resend. Check the Resend API key, sender domain setup, and outbound network access, then try again.';
    }

    if (/timeout/i.test(message) || /timed out/i.test(message)) {
      return 'Invoice sending timed out while waiting for Resend. Check the Resend configuration or provider availability, then try again.';
    }

    if (
      error &&
      typeof error === 'object' &&
      'message' in error &&
      typeof error.message === 'string'
    ) {
      return error.message;
    }

    return 'Unable to send invoice right now. Please try again.';
  }

  private async recordAudit(input: {
    actorUserId?: string;
    entityType: string;
    entityId: string;
    action: string;
    before: object | null;
    after: object | null;
  }) {
    await this.auditLogModel.create({
      actor_user_id: input.actorUserId
        ? asObjectId(input.actorUserId, 'actor user id')
        : null,
      entity_type: input.entityType,
      entity_id: input.entityId,
      action: input.action,
      before_json: input.before,
      after_json: input.after,
    });
  }
}
