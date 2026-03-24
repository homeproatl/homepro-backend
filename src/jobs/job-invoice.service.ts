import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleDestroy,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import puppeteer, { type Browser } from 'puppeteer';
import { Resend } from 'resend';
import {
  type InvoiceEmailMessageModel,
  type InvoiceDocumentModel,
  renderInvoiceEmailMessageHtml,
  renderInvoiceDocumentHtml,
} from './invoice-template';
import { generateOrderId } from '../common/utils/order-id';
import { asObjectId } from '../common/utils/object-id';
import {
  AuditLog,
  AuditLogDocument,
} from '../audit-logs/schemas/audit-log.schema';
import { PaidStatus } from '../common/enums/paid-status.enum';
import {
  ServiceCatalog,
  ServiceCatalogDocument,
} from '../service-catalog/schemas/service-catalog.schema';
import {
  Customer,
  CustomerDocument,
} from '../customers/schemas/customer.schema';
import {
  AppSettings,
  AppSettingsDocument,
} from '../settings/schemas/app-settings.schema';
import { Vehicle, VehicleDocument } from '../vehicles/schemas/vehicle.schema';
import { Job, JobDocument } from './schemas/job.schema';
import { JobPart, JobPartDocument } from './schemas/job-part.schema';
import { JobService, JobServiceDocument } from './schemas/job-service.schema';
import {
  JobInvoiceSnapshot,
  JobInvoiceSnapshotDocument,
} from './schemas/job-invoice-snapshot.schema';
import {
  JobInvoiceDispatch,
  JobInvoiceDispatchDocument,
} from './schemas/job-invoice-dispatch.schema';
import { JobInvoiceSnapshotStatus } from './enums/job-invoice-snapshot-status.enum';
import { JobInvoiceDispatchStatus } from './enums/job-invoice-dispatch-status.enum';

type InvoiceCustomerSnapshot = {
  customer_id: string;
  name: string;
  email: string | null;
  phone: string;
};

type InvoiceVehicleSnapshot = {
  vehicle_id: string;
  label: string;
  vin: string;
  license_plate: string;
};

type InvoiceServiceSnapshot = {
  job_service_id: string;
  service_id: string;
  name: string;
  quantity: number;
  unit_price_snapshot: number;
  sub_total: number;
};

type InvoicePartSnapshot = {
  job_part_id: string;
  part_name: string;
  quantity: number;
  unit_price: number;
  sub_total: number;
};

type InvoiceDocumentPayload = {
  job_id: string;
  job_number_snapshot: string;
  title_snapshot: string;
  time_zone_snapshot: string;
  customer_snapshot: InvoiceCustomerSnapshot;
  vehicle_snapshot: InvoiceVehicleSnapshot;
  services_snapshot: InvoiceServiceSnapshot[];
  parts_snapshot: InvoicePartSnapshot[];
  total: number;
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
  job_id: string;
  invoice_number: string;
  revision_number: number;
  status: JobInvoiceSnapshotStatus;
  billable_hash: string;
  issued_at: string | null;
  sent_at: string | null;
  stale_at: string | null;
  superseded_by_snapshot_id: string | null;
  created_at: string | null;
  updated_at: string | null;
};

type InvoiceAggregate = {
  job: JobDocument;
  customer: CustomerDocument;
  vehicle: VehicleDocument;
  parts: JobPartDocument[];
  services: JobServiceDocument[];
  payload: InvoiceDocumentPayload;
  blockers: string[];
  billableHash: string;
};

type InvoiceEmailResult = {
  provider: string;
  providerMessageId: string;
};

type InvoiceEmailTransport = 'LOG' | 'DISABLED' | 'RESEND';

type JobInvoiceListSummary = {
  invoice_status: JobInvoiceSnapshotStatus | null;
  latest_invoice_number: string | null;
  invoice_ready: boolean;
  send_ready: boolean;
  invoice_needs_refresh: boolean;
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

@Injectable()
export class JobInvoiceService implements OnModuleDestroy {
  private readonly logger = new Logger(JobInvoiceService.name);
  private resendClient: Resend | null = null;
  private pdfBrowserPromise: Promise<Browser> | null = null;
  private invoiceRuntimeReadinessPromise: Promise<{
    pdfBlockers: string[];
    sendBlockers: string[];
  }> | null = null;
  private invoiceRuntimeReadinessExpiresAt = 0;

  constructor(
    @InjectModel(Job.name)
    private readonly jobModel: Model<JobDocument>,
    @InjectModel(JobPart.name)
    private readonly jobPartModel: Model<JobPartDocument>,
    @InjectModel(JobService.name)
    private readonly jobServiceModel: Model<JobServiceDocument>,
    @InjectModel(Customer.name)
    private readonly customerModel: Model<CustomerDocument>,
    @InjectModel(Vehicle.name)
    private readonly vehicleModel: Model<VehicleDocument>,
    @InjectModel(ServiceCatalog.name)
    private readonly serviceCatalogModel: Model<ServiceCatalogDocument>,
    @InjectModel(JobInvoiceSnapshot.name)
    private readonly jobInvoiceSnapshotModel: Model<JobInvoiceSnapshotDocument>,
    @InjectModel(JobInvoiceDispatch.name)
    private readonly jobInvoiceDispatchModel: Model<JobInvoiceDispatchDocument>,
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

  async getInvoicePreview(jobId: string) {
    const aggregate = await this.loadInvoiceAggregate(jobId);
    const latestSnapshot = await this.reconcileLatestSnapshot(aggregate);
    const readiness = await this.getInvoiceBillingReadiness(aggregate);

    return {
      ready: aggregate.blockers.length === 0,
      blockers: aggregate.blockers,
      pdf_ready: readiness.pdfBlockers.length === 0,
      pdf_blockers: readiness.pdfBlockers,
      send_ready: readiness.sendBlockers.length === 0,
      send_blockers: readiness.sendBlockers,
      needs_refresh: latestSnapshot?.status === JobInvoiceSnapshotStatus.STALE,
      latest_snapshot: latestSnapshot
        ? this.serializeSnapshot(latestSnapshot)
        : null,
      preview: aggregate.payload,
    };
  }

  async getLatestInvoice(jobId: string) {
    const aggregate = await this.loadInvoiceAggregate(jobId);
    const latestSnapshot = await this.reconcileLatestSnapshot(aggregate);
    const readiness = await this.getInvoiceBillingReadiness(aggregate);

    return {
      ready: aggregate.blockers.length === 0,
      blockers: aggregate.blockers,
      pdf_ready: readiness.pdfBlockers.length === 0,
      pdf_blockers: readiness.pdfBlockers,
      send_ready: readiness.sendBlockers.length === 0,
      send_blockers: readiness.sendBlockers,
      needs_refresh: latestSnapshot?.status === JobInvoiceSnapshotStatus.STALE,
      snapshot: latestSnapshot ? this.serializeSnapshot(latestSnapshot) : null,
    };
  }

  async getJobBillingSummary(jobId: string): Promise<JobInvoiceListSummary> {
    const aggregate = await this.loadInvoiceAggregate(jobId);
    const latestSnapshot = await this.reconcileLatestSnapshot(aggregate);
    const readiness = await this.getInvoiceBillingReadiness(aggregate);

    return {
      invoice_status: latestSnapshot?.status ?? null,
      latest_invoice_number: latestSnapshot?.invoice_number ?? null,
      invoice_ready: aggregate.blockers.length === 0,
      send_ready: readiness.sendBlockers.length === 0,
      invoice_needs_refresh:
        latestSnapshot?.status === JobInvoiceSnapshotStatus.STALE,
    };
  }

  async getInvoiceHistory(jobId: string) {
    const aggregate = await this.loadInvoiceAggregate(jobId);
    await this.reconcileLatestSnapshot(aggregate);

    const snapshots = await this.jobInvoiceSnapshotModel
      .find({ job_id: aggregate.job._id })
      .sort({ revision_number: -1, created_at: -1 })
      .exec();
    const dispatches = await this.jobInvoiceDispatchModel
      .find({ job_id: aggregate.job._id })
      .sort({ created_at: -1 })
      .exec();

    return {
      snapshots: snapshots.map((snapshot) => this.serializeSnapshot(snapshot)),
      dispatches: dispatches.map((dispatch) =>
        this.serializeDispatch(dispatch),
      ),
    };
  }

  async issueInvoice(jobId: string, actorUserId?: string) {
    const aggregate = await this.loadInvoiceAggregate(jobId);
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

  async sendInvoice(jobId: string, actorUserId?: string) {
    const aggregate = await this.loadInvoiceAggregate(jobId);
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
    const invoiceProvider = this.getInvoiceProviderName();
    const dispatch = await this.jobInvoiceDispatchModel.create({
      job_id: snapshot.job_id,
      invoice_snapshot_id: snapshot._id,
      recipient_email: aggregate.customer.email?.toLowerCase(),
      provider: invoiceProvider,
      provider_message_id: null,
      delivery_status: JobInvoiceDispatchStatus.PENDING,
      error_message: null,
      sent_at: null,
    });

    try {
      const renderPayload = this.serializeSnapshot(snapshot);
      const pdfBytes = await this.renderInvoicePdf(renderPayload);
      const emailMessage = this.toInvoiceEmailMessageModel({
        invoiceNumber: snapshot.invoice_number,
        customerName: aggregate.customer.first_name
          ? `${aggregate.customer.first_name} ${aggregate.customer.last_name}`.trim()
          : aggregate.payload.customer_snapshot.name,
        jobNumber: aggregate.payload.job_number_snapshot,
        total: aggregate.payload.total,
        dueDate: aggregate.payload.due_date_snapshot,
        timeZone: aggregate.payload.time_zone_snapshot,
      });
      const result = await this.sendInvoiceEmail({
        invoiceNumber: snapshot.invoice_number,
        recipientEmail: aggregate.customer.email ?? '',
        html: renderInvoiceEmailMessageHtml(emailMessage),
        text: this.renderInvoiceText({
          invoiceNumber: emailMessage.invoiceNumber,
          customerName: emailMessage.customerName,
          jobNumber: emailMessage.jobNumber,
          total: emailMessage.total,
          dueDate: emailMessage.dueDate,
          timeZone: emailMessage.timeZone,
        }),
        pdfBytes,
      });
      const sentAt = new Date();
      dispatch.provider = result.provider;
      dispatch.provider_message_id = result.providerMessageId;
      dispatch.delivery_status = JobInvoiceDispatchStatus.SENT;
      dispatch.error_message = null;
      dispatch.sent_at = sentAt;
      await dispatch.save();

      snapshot.status = JobInvoiceSnapshotStatus.SENT;
      snapshot.sent_at = sentAt;
      await snapshot.save();

      await this.recordAudit({
        actorUserId,
        entityType: 'job',
        entityId: String(snapshot.job_id),
        action: 'job.invoice.sent',
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
      dispatch.delivery_status = JobInvoiceDispatchStatus.FAILED;
      dispatch.error_message = this.asInvoiceErrorMessage(error);
      dispatch.sent_at = null;
      await dispatch.save();

      await this.recordAudit({
        actorUserId,
        entityType: 'job',
        entityId: String(snapshot.job_id),
        action: 'job.invoice.send_failed',
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

  async getInvoicePdf(jobId: string) {
    const aggregate = await this.loadInvoiceAggregate(jobId);
    const latestSnapshot = await this.reconcileLatestSnapshot(aggregate);
    const useLatestSnapshot =
      latestSnapshot &&
      latestSnapshot.status !== JobInvoiceSnapshotStatus.STALE &&
      latestSnapshot.status !== JobInvoiceSnapshotStatus.VOID;
    const source = useLatestSnapshot
      ? this.serializeSnapshot(latestSnapshot)
      : aggregate.payload;
    const pdfBytes = await this.renderInvoicePdf(source);

    return {
      fileName: useLatestSnapshot
        ? `${latestSnapshot.invoice_number}.pdf`
        : `${aggregate.job.job_number}-preview.pdf`,
      buffer: Buffer.from(pdfBytes),
    };
  }

  async markLatestSnapshotStaleIfNeeded(jobId: string) {
    const aggregate = await this.loadInvoiceAggregate(jobId);
    await this.reconcileLatestSnapshot(aggregate);
  }

  private async loadInvoiceAggregate(jobId: string): Promise<InvoiceAggregate> {
    const job = await this.jobModel
      .findById(asObjectId(jobId, 'job id'))
      .exec();
    if (!job) {
      throw new NotFoundException('Job not found');
    }

    const [customer, vehicle, parts, services] = await Promise.all([
      this.customerModel.findById(job.customer_id).exec(),
      this.vehicleModel.findById(job.vehicle_id).exec(),
      this.jobPartModel
        .find({ job_id: job._id })
        .sort({ created_at: 1 })
        .exec(),
      this.jobServiceModel
        .find({ job_id: job._id })
        .sort({ created_at: 1 })
        .exec(),
    ]);

    if (!customer) {
      throw new NotFoundException('Customer not found');
    }
    if (!vehicle) {
      throw new NotFoundException('Vehicle not found');
    }

    const serviceIds = services.map((service) => String(service.service_id));
    const serviceCatalog = await this.serviceCatalogModel
      .find({
        _id: { $in: serviceIds.map((id) => asObjectId(id, 'service id')) },
      })
      .exec();
    const serviceNameById = new Map(
      serviceCatalog.map((service) => [String(service._id), service.name]),
    );
    const invoiceTimeZone = await this.resolveInvoiceTimeZone();

    const customerSnapshot: InvoiceCustomerSnapshot = {
      customer_id: String(customer._id),
      name: `${customer.first_name} ${customer.last_name}`.trim(),
      email: customer.email,
      phone: customer.phone,
    };

    const vehicleSnapshot: InvoiceVehicleSnapshot = {
      vehicle_id: String(vehicle._id),
      label: `${vehicle.license_plate} · ${vehicle.make} ${vehicle.model}`,
      vin: vehicle.vin,
      license_plate: vehicle.license_plate,
    };

    const servicesSnapshot: InvoiceServiceSnapshot[] = services.map((line) => ({
      job_service_id: String(line._id),
      service_id: String(line.service_id),
      name:
        serviceNameById.get(String(line.service_id)) ?? String(line.service_id),
      quantity: line.quantity,
      unit_price_snapshot: line.unit_price_snapshot,
      sub_total: line.sub_total,
    }));

    const partsSnapshot: InvoicePartSnapshot[] = parts.map((line) => ({
      job_part_id: String(line._id),
      part_name: line.part_name,
      quantity: line.quantity,
      unit_price: line.unit_price,
      sub_total: line.sub_total,
    }));

    const payload: InvoiceDocumentPayload = {
      job_id: String(job._id),
      job_number_snapshot: job.job_number,
      title_snapshot: job.title,
      time_zone_snapshot: invoiceTimeZone,
      customer_snapshot: customerSnapshot,
      vehicle_snapshot: vehicleSnapshot,
      services_snapshot: servicesSnapshot,
      parts_snapshot: partsSnapshot,
      total: job.total,
      payment_status_snapshot: job.payment_status,
      payment_type_snapshot: job.payment_type,
      due_date_snapshot: job.due_date ? job.due_date.toISOString() : null,
      scheduled_start_snapshot: job.scheduled_start
        ? job.scheduled_start.toISOString()
        : null,
      scheduled_end_snapshot: job.scheduled_end
        ? job.scheduled_end.toISOString()
        : null,
      generated_at: new Date().toISOString(),
    };

    const blockers: string[] = [];
    if (!customer.email) {
      blockers.push(
        'Customer email is required before an invoice can be issued or sent.',
      );
    }
    if (
      job.total <= 0 &&
      servicesSnapshot.length === 0 &&
      partsSnapshot.length === 0
    ) {
      blockers.push(
        'Add at least one billable line before issuing an invoice.',
      );
    }

    return {
      job,
      customer,
      vehicle,
      parts,
      services,
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
      job_number_snapshot: payload.job_number_snapshot,
      title_snapshot: payload.title_snapshot,
      time_zone_snapshot: payload.time_zone_snapshot,
      customer_snapshot: payload.customer_snapshot,
      vehicle_snapshot: payload.vehicle_snapshot,
      services_snapshot: payload.services_snapshot,
      parts_snapshot: payload.parts_snapshot,
      total: payload.total,
      payment_status_snapshot: payload.payment_status_snapshot,
      payment_type_snapshot: payload.payment_type_snapshot,
      due_date_snapshot: payload.due_date_snapshot,
      scheduled_start_snapshot: payload.scheduled_start_snapshot,
      scheduled_end_snapshot: payload.scheduled_end_snapshot,
    });
  }

  private async reconcileLatestSnapshot(aggregate: InvoiceAggregate) {
    const latestSnapshot = await this.jobInvoiceSnapshotModel
      .findOne({ job_id: aggregate.job._id })
      .sort({ revision_number: -1, created_at: -1 })
      .exec();

    if (!latestSnapshot) {
      return null;
    }

    const isBillableSnapshot =
      latestSnapshot.status === JobInvoiceSnapshotStatus.ISSUED ||
      latestSnapshot.status === JobInvoiceSnapshotStatus.SENT;

    if (
      isBillableSnapshot &&
      latestSnapshot.billable_hash !== aggregate.billableHash
    ) {
      latestSnapshot.status = JobInvoiceSnapshotStatus.STALE;
      latestSnapshot.stale_at = new Date();
      await latestSnapshot.save();
    }

    return latestSnapshot;
  }

  private async resolveIssueableSnapshot(
    aggregate: InvoiceAggregate,
    actorUserId?: string,
  ) {
    if (aggregate.blockers.length > 0) {
      throw new BadRequestException(aggregate.blockers.join(' '));
    }

    const latestSnapshot = await this.reconcileLatestSnapshot(aggregate);
    if (
      latestSnapshot &&
      latestSnapshot.status !== JobInvoiceSnapshotStatus.STALE &&
      latestSnapshot.status !== JobInvoiceSnapshotStatus.VOID &&
      latestSnapshot.billable_hash === aggregate.billableHash
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
      entityType: 'job',
      entityId: String(aggregate.job._id),
      action: 'job.invoice.issued',
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
        const latestSnapshot = await this.jobInvoiceSnapshotModel
          .findOne({ job_id: aggregate.job._id })
          .sort({ revision_number: -1, created_at: -1 })
          .exec();
        const revisionNumber = latestSnapshot
          ? latestSnapshot.revision_number + 1
          : 1;
        return await this.jobInvoiceSnapshotModel.create({
          job_id: aggregate.job._id,
          invoice_number: `INV-${generateOrderId()}`,
          revision_number: revisionNumber,
          status: JobInvoiceSnapshotStatus.ISSUED,
          customer_snapshot: aggregate.payload.customer_snapshot,
          vehicle_snapshot: aggregate.payload.vehicle_snapshot,
          services_snapshot: aggregate.payload.services_snapshot,
          parts_snapshot: aggregate.payload.parts_snapshot,
          job_number_snapshot: aggregate.payload.job_number_snapshot,
          title_snapshot: aggregate.payload.title_snapshot,
          time_zone_snapshot: aggregate.payload.time_zone_snapshot,
          total: aggregate.payload.total,
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

  private serializeSnapshot(
    snapshot: JobInvoiceSnapshotDocument,
  ): SerializedInvoiceSnapshot {
    const raw = snapshot.toObject();

    return {
      ...raw,
      id: String(raw._id),
      job_id: String(raw.job_id),
      customer_snapshot: raw.customer_snapshot as InvoiceCustomerSnapshot,
      vehicle_snapshot: raw.vehicle_snapshot as InvoiceVehicleSnapshot,
      services_snapshot: raw.services_snapshot as InvoiceServiceSnapshot[],
      parts_snapshot: raw.parts_snapshot as InvoicePartSnapshot[],
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

  private serializeDispatch(dispatch: JobInvoiceDispatchDocument) {
    const raw = dispatch.toObject();
    return {
      ...raw,
      id: String(raw._id),
      job_id: String(raw.job_id),
      invoice_snapshot_id: String(raw.invoice_snapshot_id),
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
          ],
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
    jobNumber: string;
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
      `Attached to this email is your invoice ${input.invoiceNumber} for job ${input.jobNumber}.`,
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
      : 'Preview';
  }

  private getInvoiceServiceRows(invoice: InvoiceRenderPayload) {
    return invoice.services_snapshot.map((line) => ({
      description: line.name,
      quantity: line.quantity,
      unitPrice: line.unit_price_snapshot,
      subTotal: line.sub_total,
    }));
  }

  private getInvoicePartRows(invoice: InvoiceRenderPayload) {
    return invoice.parts_snapshot.map((line) => ({
      description: line.part_name,
      quantity: line.quantity,
      unitPrice: line.unit_price,
      subTotal: line.sub_total,
    }));
  }

  private toInvoiceDocumentModel(
    invoice: InvoiceRenderPayload,
  ): InvoiceDocumentModel {
    return {
      invoiceNumber: this.getInvoiceDocumentLabel(invoice),
      jobNumber: invoice.job_number_snapshot,
      title: invoice.title_snapshot,
      timeZone: invoice.time_zone_snapshot,
      customerName: invoice.customer_snapshot.name,
      customerEmail: invoice.customer_snapshot.email,
      customerPhone: invoice.customer_snapshot.phone,
      vehicleLabel: invoice.vehicle_snapshot.label,
      vehicleVin: invoice.vehicle_snapshot.vin,
      vehiclePlate: invoice.vehicle_snapshot.license_plate,
      dueDate: invoice.due_date_snapshot,
      generatedAt: invoice.generated_at,
      paymentStatus: invoice.payment_status_snapshot,
      total: invoice.total,
      services: this.getInvoiceServiceRows(invoice),
      parts: this.getInvoicePartRows(invoice),
      mode:
        'invoice_number' in invoice && invoice.invoice_number
          ? 'issued'
          : 'preview',
    };
  }

  private toInvoiceEmailMessageModel(input: {
    invoiceNumber: string;
    customerName: string;
    jobNumber: string;
    total: number;
    dueDate: string | null;
    timeZone: string;
  }): InvoiceEmailMessageModel {
    return {
      invoiceNumber: input.invoiceNumber,
      customerName: input.customerName,
      jobNumber: input.jobNumber,
      total: input.total,
      dueDate: input.dueDate,
      timeZone: input.timeZone,
    };
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

  private async getPdfBrowser() {
    if (!this.pdfBrowserPromise) {
      const browserPromise = puppeteer
        .launch({
          headless: true,
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

    return {
      pdfBlockers: runtimeReadiness.pdfBlockers,
      sendBlockers: Array.from(
        new Set([...aggregateBlockers, ...runtimeReadiness.sendBlockers]),
      ),
    };
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
