import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { generateOrderId } from '../common/utils/order-id';
import { asObjectId } from '../common/utils/object-id';
import { PaidStatus } from '../common/enums/paid-status.enum';
import { PaymentType } from '../common/enums/payment-type.enum';
import { EstimateStatus } from '../common/enums/estimate-status.enum';
import {
  AuditLog,
  AuditLogDocument,
} from '../audit-logs/schemas/audit-log.schema';
import { EstimateInvoiceSnapshotStatus } from './enums/estimate-invoice-snapshot-status.enum';
import { EstimateDataService } from './estimate-data.service';
import { EstimateDomainService } from './estimate-domain.service';
import { EstimateInvoiceService } from './estimate-invoice.service';
import { CreateEstimateDto } from './dto/create-estimate.dto';
import { ListEstimatesQueryDto } from './dto/list-estimates-query.dto';
import { UpdateEstimatePaymentStatusDto } from './dto/update-estimate-payment-status.dto';
import { UpdateEstimateStatusDto } from './dto/update-estimate-status.dto';
import { UpdateEstimateDto } from './dto/update-estimate.dto';
import { Estimate, EstimateDocument } from './schemas/estimate.schema';

type AdminInvoiceWorkflowState =
  | 'blocked'
  | 'ready_to_send'
  | 'sent'
  | 'needs_resend';

type EstimateBillingSummary = {
  invoice_status: EstimateInvoiceSnapshotStatus | null;
  latest_invoice_number: string | null;
  invoice_ready: boolean;
  send_ready: boolean;
  invoice_needs_refresh: boolean;
};

type EstimateWorkflowSummary = {
  admin_invoice_workflow_state: AdminInvoiceWorkflowState;
  admin_invoice_workflow_title: string;
  admin_invoice_workflow_detail: string;
};

type DashboardSummaryEstimate = {
  id: string;
  estimate_status?: EstimateStatus;
  payment_status?: PaidStatus;
  total?: number;
  due_date?: string | Date | null;
  is_overdue: boolean;
  admin_invoice_workflow_state: AdminInvoiceWorkflowState;
};

@Injectable()
export class EstimatesService {
  private readonly paymentStatusTransitions: Record<PaidStatus, PaidStatus[]> =
    {
      [PaidStatus.UNPAID]: [PaidStatus.PART_PAID, PaidStatus.PAID],
      [PaidStatus.PART_PAID]: [PaidStatus.UNPAID, PaidStatus.PAID],
      [PaidStatus.PAID]: [PaidStatus.PART_PAID],
    };

  constructor(
    @InjectModel(Estimate.name)
    private readonly estimateModel: Model<EstimateDocument>,
    @InjectModel(AuditLog.name)
    private readonly auditLogModel: Model<AuditLogDocument>,
    private readonly estimateDataService: EstimateDataService,
    private readonly estimateDomainService: EstimateDomainService,
    private readonly estimateInvoiceService: EstimateInvoiceService,
  ) {}

  async create(payload: CreateEstimateDto, actorUserId?: string) {
    const created = await this.createEstimateWithUniqueNumber({
      title: payload.title,
      customer_id: payload.customer_id,
      vehicle_id: payload.vehicle_id,
      scheduled_start: payload.scheduled_start
        ? new Date(payload.scheduled_start)
        : null,
      scheduled_end: payload.scheduled_end
        ? new Date(payload.scheduled_end)
        : null,
      assigned_user_id: payload.assigned_user_id ?? null,
      complaint_or_request: payload.complaint_or_request ?? null,
      notes: payload.notes ?? null,
      estimate_status: EstimateStatus.SCHEDULED,
      payment_status: payload.payment_status,
      payment_type: payload.payment_type,
      due_date: payload.due_date ? new Date(payload.due_date) : null,
      services: payload.services,
    });

    await this.recordAudit({
      actorUserId,
      entityType: 'estimate',
      entityId: String(created._id),
      action: 'estimate.created',
      before: null,
      after: created.toObject(),
    });

    return this.withDerivedEstimate(created);
  }

  async findAll(filters: ListEstimatesQueryDto = {}) {
    const query: Record<string, unknown> = {};

    if (filters.customer_id) {
      query.customer_id = asObjectId(filters.customer_id, 'customer id');
    }

    if (filters.vehicle_id) {
      query.vehicle_id = asObjectId(filters.vehicle_id, 'vehicle id');
    }

    const estimates = await this.estimateModel
      .find(query)
      .sort({ created_at: -1 })
      .exec();
    const estimatesWithBillingSummaries = await this.withBillingSummaries(estimates);

    return estimatesWithBillingSummaries.filter((estimate) => {
      if (
        filters.invoice_status &&
        (estimate.invoice_status ?? 'NONE') !== filters.invoice_status
      ) {
        return false;
      }

      if (
        filters.ready_to_invoice !== undefined &&
        estimate.invoice_ready !== filters.ready_to_invoice
      ) {
        return false;
      }

      if (filters.overdue !== undefined && estimate.is_overdue !== filters.overdue) {
        return false;
      }

      return true;
    });
  }

  async getDashboardSummary() {
    const estimates = (await this.findAll()) as DashboardSummaryEstimate[];
    const overviewEstimates = this.getDashboardOverviewEstimates(estimates);
    let activeJobs = 0;
    let readyToSend = 0;
    let overdueBilling = 0;
    let unpaidBilling = 0;

    for (const estimate of estimates) {
      if (
        estimate.estimate_status &&
        [
          EstimateStatus.SCHEDULED,
          EstimateStatus.CHECKED_IN,
          EstimateStatus.IN_PROGRESS,
        ].includes(estimate.estimate_status)
      ) {
        activeJobs += 1;
      }

      if (estimate.admin_invoice_workflow_state === 'ready_to_send') {
        readyToSend += 1;
      }

      if (!this.isBillingVisible(estimate)) {
        continue;
      }

      if (estimate.is_overdue) {
        overdueBilling += 1;
      }

      if ((estimate.payment_status ?? PaidStatus.UNPAID) === PaidStatus.UNPAID) {
        unpaidBilling += 1;
      }
    }

    return {
      overview_estimates: overviewEstimates,
      active_estimates: activeJobs,
      ready_to_send: readyToSend,
      overdue_billing: overdueBilling,
      unpaid_billing: unpaidBilling,
    };
  }

  async findById(id: string) {
    const estimate = await this.estimateModel.findById(asObjectId(id, 'estimate id')).exec();
    if (!estimate) {
      throw new NotFoundException('Estimate not found');
    }

    const [estimateWithBillingSummary] = await this.withBillingSummaries([estimate]);
    return estimateWithBillingSummary;
  }

  async remove(id: string, actorUserId?: string) {
    const estimate = await this.estimateModel.findById(asObjectId(id, 'estimate id')).exec();
    if (!estimate) {
      throw new NotFoundException('Estimate not found');
    }

    const invoiceHistoryCounts =
      await this.estimateInvoiceService.getInvoiceHistoryCounts(id);
    if (
      invoiceHistoryCounts.snapshotCount > 0 ||
      invoiceHistoryCounts.dispatchCount > 0
    ) {
      throw new ConflictException(
        'Estimate cannot be deleted because invoice history already exists for it.',
      );
    }

    const canHardDelete =
      estimate.services.length === 0 &&
      estimate.payment_status === PaidStatus.UNPAID &&
      [EstimateStatus.SCHEDULED, EstimateStatus.CANCELLED, EstimateStatus.NO_SHOW].includes(
        estimate.estimate_status,
      );

    if (!canHardDelete) {
      throw new ConflictException(
        'Estimate can only be deleted before work or billing activity begins. Cancel it instead.',
      );
    }

    const before = estimate.toObject();
    const session = await this.estimateModel.db.startSession();

    try {
      await session.withTransaction(async () => {
        await this.estimateInvoiceService.deleteInvoiceHistoryForEstimate(
          id,
          session,
        );
        await this.estimateModel.deleteOne({ _id: estimate._id }, { session }).exec();
      });
    } finally {
      await session.endSession();
    }

    await this.recordAudit({
      actorUserId,
      entityType: 'estimate',
      entityId: String(estimate._id),
      action: 'estimate.deleted',
      before,
      after: null,
    });

    return { deleted: true };
  }

  async update(id: string, payload: UpdateEstimateDto, actorUserId?: string) {
    const estimate = await this.estimateModel.findById(asObjectId(id, 'estimate id')).exec();
    if (!estimate) {
      throw new NotFoundException('Estimate not found');
    }

    if (
      payload.estimate_status &&
      payload.estimate_status !== estimate.estimate_status &&
      !this.estimateDomainService.canTransitionStatus(
        estimate.estimate_status,
        payload.estimate_status,
      )
    ) {
      throw new BadRequestException(
        `Invalid estimate status transition from ${estimate.estimate_status} to ${payload.estimate_status}`,
      );
    }

    const before = estimate.toObject();
    const currentServices = estimate.services.map((service) => ({
      canned_service_id: service.canned_service_id
        ? String(service.canned_service_id)
        : null,
      name: service.name,
      labor_lines: service.labor_lines.map((line) => ({
        description: line.description,
        assigned_user_id: line.assigned_user_id
          ? String(line.assigned_user_id)
          : null,
        hours: line.hours,
        rate: line.rate,
        discount_percent: line.discount_percent,
      })),
      part_lines: service.part_lines.map((line) => ({
        name: line.name,
        quantity: line.quantity,
        cost: line.cost,
        price: line.price,
        discount_percent: line.discount_percent,
      })),
    }));

    estimate.estimate_status = payload.estimate_status ?? estimate.estimate_status;

    await this.estimateDataService.applyEstimateUpdate(estimate, {
      title: payload.title ?? estimate.title,
      customer_id: payload.customer_id ?? String(estimate.customer_id),
      vehicle_id: payload.vehicle_id ?? String(estimate.vehicle_id),
      scheduled_start:
        payload.scheduled_start === undefined
          ? estimate.scheduled_start
          : payload.scheduled_start
            ? new Date(payload.scheduled_start)
            : null,
      scheduled_end:
        payload.scheduled_end === undefined
          ? estimate.scheduled_end
          : payload.scheduled_end
            ? new Date(payload.scheduled_end)
            : null,
      assigned_user_id:
        payload.assigned_user_id === undefined
          ? estimate.assigned_user_id
            ? String(estimate.assigned_user_id)
            : null
          : payload.assigned_user_id,
      complaint_or_request:
        payload.complaint_or_request === undefined
          ? estimate.complaint_or_request
          : payload.complaint_or_request,
      notes: payload.notes === undefined ? estimate.notes : payload.notes,
      payment_type: payload.payment_type ?? estimate.payment_type,
      due_date:
        payload.due_date === undefined
          ? estimate.due_date
          : payload.due_date
            ? new Date(payload.due_date)
            : null,
      services: payload.services ?? currentServices,
    });

    await this.recordAudit({
      actorUserId,
      entityType: 'estimate',
      entityId: String(estimate._id),
      action: 'estimate.updated',
      before,
      after: estimate.toObject(),
    });
    await this.estimateInvoiceService.markLatestSnapshotStaleIfNeeded(id);

    return this.withDerivedEstimate(estimate);
  }

  async updateStatus(
    id: string,
    payload: UpdateEstimateStatusDto,
    actorUserId?: string,
  ) {
    const estimate = await this.estimateModel.findById(asObjectId(id, 'estimate id')).exec();
    if (!estimate) {
      throw new NotFoundException('Estimate not found');
    }

    if (
      !this.estimateDomainService.canTransitionStatus(
        estimate.estimate_status,
        payload.estimate_status,
      )
    ) {
      throw new BadRequestException(
        `Invalid estimate status transition from ${estimate.estimate_status} to ${payload.estimate_status}`,
      );
    }

    const before = estimate.toObject();
    estimate.estimate_status = payload.estimate_status;
    await estimate.save();

    await this.recordAudit({
      actorUserId,
      entityType: 'estimate',
      entityId: String(estimate._id),
      action: 'estimate.status.updated',
      before,
      after: estimate.toObject(),
    });

    return this.withDerivedEstimate(estimate);
  }

  async updatePaymentStatus(
    id: string,
    payload: UpdateEstimatePaymentStatusDto,
    actorUserId?: string,
  ) {
    const estimate = await this.estimateModel.findById(asObjectId(id, 'estimate id')).exec();
    if (!estimate) {
      throw new NotFoundException('Estimate not found');
    }

    this.assertValidPaymentTransition(
      estimate.payment_status,
      payload.payment_status,
    );

    const before = estimate.toObject();
    estimate.payment_status = payload.payment_status;
    await estimate.save();
    await this.recordAudit({
      actorUserId,
      entityType: 'estimate',
      entityId: String(estimate._id),
      action: 'estimate.payment_status.updated',
      before,
      after: estimate.toObject(),
    });
    await this.estimateInvoiceService.markLatestSnapshotStaleIfNeeded(id);

    return this.withDerivedEstimate(estimate);
  }

  async calendar(filters: {
    date_from?: string;
    date_to?: string;
    assigned_user_id?: string;
    status?: EstimateStatus;
  }) {
    const query: Record<string, unknown> = {};
    if (filters.assigned_user_id) {
      query.assigned_user_id = asObjectId(
        filters.assigned_user_id,
        'assigned user id',
      );
    }
    if (filters.status) {
      query.estimate_status = filters.status;
    }
    if (filters.date_from) {
      query.scheduled_end = { $gt: new Date(filters.date_from) };
    }
    if (filters.date_to) {
      query.scheduled_start = { $lt: new Date(filters.date_to) };
    }

    const estimates = await this.estimateModel
      .find(query)
      .sort({ scheduled_start: 1 })
      .exec();
    return this.withBillingSummaries(estimates);
  }

  async getInvoicePreview(id: string) {
    return this.estimateInvoiceService.getInvoicePreview(id);
  }

  async getLatestInvoice(id: string) {
    return this.estimateInvoiceService.getLatestInvoice(id);
  }

  async getInvoiceHistory(id: string) {
    return this.estimateInvoiceService.getInvoiceHistory(id);
  }

  async issueInvoice(id: string, actorUserId?: string) {
    return this.estimateInvoiceService.issueInvoice(id, actorUserId);
  }

  async sendInvoice(id: string, actorUserId?: string) {
    return this.estimateInvoiceService.sendInvoice(id, actorUserId);
  }

  async getInvoicePdf(id: string) {
    return this.estimateInvoiceService.getInvoicePdf(id);
  }

  private async createEstimateWithUniqueNumber(input: {
    title: string;
    customer_id: string;
    vehicle_id: string;
    scheduled_start?: Date | null;
    scheduled_end?: Date | null;
    assigned_user_id?: string | null;
    complaint_or_request?: string | null;
    notes?: string | null;
    estimate_status?: EstimateStatus;
    payment_status?: PaidStatus;
    payment_type?: PaymentType;
    due_date?: Date | null;
    services: CreateEstimateDto['services'];
  }) {
    const maxAttempts = 5;
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      try {
        return await this.estimateDataService.createEstimate({
          estimate_number: generateOrderId(),
          title: input.title,
          customer_id: input.customer_id,
          vehicle_id: input.vehicle_id,
          scheduled_start: input.scheduled_start ?? null,
          scheduled_end: input.scheduled_end ?? null,
          assigned_user_id: input.assigned_user_id ?? null,
          complaint_or_request: input.complaint_or_request ?? null,
          notes: input.notes ?? null,
          estimate_status: input.estimate_status,
          payment_status: input.payment_status,
          payment_type: input.payment_type,
          due_date: input.due_date ?? null,
          services: input.services,
        });
      } catch (error) {
        if (
          (error as { code?: number }).code === 11000 &&
          attempt < maxAttempts
        ) {
          continue;
        }
        if ((error as { code?: number }).code === 11000) {
          throw new ConflictException(
            'Could not generate a unique estimate number. Please retry.',
          );
        }
        throw error;
      }
    }

    throw new ConflictException('Could not generate a unique estimate number');
  }

  private assertValidPaymentTransition(from: PaidStatus, to: PaidStatus) {
    if (from === to) {
      return;
    }
    if (!this.paymentStatusTransitions[from].includes(to)) {
      throw new BadRequestException(
        `Invalid payment status transition from ${from} to ${to}`,
      );
    }
  }

  private withDerivedEstimate(
    estimate: EstimateDocument | (Estimate & { _id: unknown }),
    billingSummary?: EstimateBillingSummary,
  ) {
    const rawEstimate =
      typeof (estimate as EstimateDocument).toObject === 'function'
        ? ((estimate as EstimateDocument).toObject() as unknown as Record<
            string,
            unknown
          >)
        : (estimate as unknown as Record<string, unknown>);

    const dueDate = rawEstimate.due_date
      ? new Date(rawEstimate.due_date as string | Date)
      : null;
    const paymentStatus = rawEstimate.payment_status as PaidStatus;
    const isOverdue =
      !!dueDate &&
      dueDate.getTime() < Date.now() &&
      paymentStatus !== PaidStatus.PAID;
    const resolvedBillingSummary: EstimateBillingSummary = {
      invoice_status: billingSummary?.invoice_status ?? null,
      latest_invoice_number: billingSummary?.latest_invoice_number ?? null,
      invoice_ready: billingSummary?.invoice_ready ?? false,
      send_ready: billingSummary?.send_ready ?? false,
      invoice_needs_refresh: billingSummary?.invoice_needs_refresh ?? false,
    };
    const workflowSummary = this.getAdminInvoiceWorkflowSummary(
      resolvedBillingSummary,
    );

    return {
      id: this.serializeId(rawEstimate._id, 'estimate id'),
      estimate_number:
        typeof rawEstimate.estimate_number === 'string'
          ? rawEstimate.estimate_number
          : '',
      title: typeof rawEstimate.title === 'string' ? rawEstimate.title : '',
      customer_id: this.serializeId(rawEstimate.customer_id, 'customer id'),
      vehicle_id: this.serializeId(rawEstimate.vehicle_id, 'vehicle id'),
      scheduled_start: this.toIsoString(
        rawEstimate.scheduled_start as Date | string | null | undefined,
      ),
      scheduled_end: this.toIsoString(
        rawEstimate.scheduled_end as Date | string | null | undefined,
      ),
      assigned_user_id: this.serializeNullableId(
        rawEstimate.assigned_user_id,
        'assigned user id',
      ),
      complaint_or_request:
        typeof rawEstimate.complaint_or_request === 'string'
          ? rawEstimate.complaint_or_request
          : null,
      notes: typeof rawEstimate.notes === 'string' ? rawEstimate.notes : null,
      estimate_status: rawEstimate.estimate_status as EstimateStatus,
      payment_status: paymentStatus,
      payment_type: rawEstimate.payment_type as PaymentType,
      due_date: this.toIsoString(
        rawEstimate.due_date as Date | string | null | undefined,
      ),
      services: this.serializeServices(
        rawEstimate.services as Array<Record<string, unknown>> | undefined,
      ),
      labor_total:
        typeof rawEstimate.labor_total === 'number' ? rawEstimate.labor_total : 0,
      parts_total:
        typeof rawEstimate.parts_total === 'number' ? rawEstimate.parts_total : 0,
      total: typeof rawEstimate.total === 'number' ? rawEstimate.total : 0,
      created_at: this.toIsoString(
        rawEstimate.created_at as Date | string | null | undefined,
      ),
      updated_at: this.toIsoString(
        rawEstimate.updated_at as Date | string | null | undefined,
      ),
      is_overdue: isOverdue,
      ...resolvedBillingSummary,
      ...workflowSummary,
    };
  }

  private serializeServices(services?: Array<Record<string, unknown>>) {
    return (services ?? []).map((service) => ({
      id: this.serializeId(service._id, 'estimate service id'),
      canned_service_id: this.serializeNullableId(
        service.canned_service_id,
        'canned service id',
      ),
      name: typeof service.name === 'string' ? service.name : '',
      labor_lines: this.serializeLaborLines(
        service.labor_lines as Array<Record<string, unknown>> | undefined,
      ),
      part_lines: this.serializePartLines(
        service.part_lines as Array<Record<string, unknown>> | undefined,
      ),
      labor_total: typeof service.labor_total === 'number' ? service.labor_total : 0,
      parts_total: typeof service.parts_total === 'number' ? service.parts_total : 0,
      total: typeof service.total === 'number' ? service.total : 0,
    }));
  }

  private serializeLaborLines(lines?: Array<Record<string, unknown>>) {
    return (lines ?? []).map((line) => ({
      id: this.serializeId(line._id, 'estimate labor line id'),
      description: typeof line.description === 'string' ? line.description : '',
      assigned_user_id: this.serializeNullableId(
        line.assigned_user_id,
        'estimate labor technician id',
      ),
      hours: typeof line.hours === 'number' ? line.hours : 0,
      rate: typeof line.rate === 'number' ? line.rate : 0,
      discount_percent:
        typeof line.discount_percent === 'number' ? line.discount_percent : 0,
      subtotal: typeof line.subtotal === 'number' ? line.subtotal : 0,
    }));
  }

  private serializePartLines(lines?: Array<Record<string, unknown>>) {
    return (lines ?? []).map((line) => ({
      id: this.serializeId(line._id, 'estimate part line id'),
      name: typeof line.name === 'string' ? line.name : '',
      quantity: typeof line.quantity === 'number' ? line.quantity : 0,
      cost: typeof line.cost === 'number' ? line.cost : null,
      price: typeof line.price === 'number' ? line.price : 0,
      discount_percent:
        typeof line.discount_percent === 'number' ? line.discount_percent : 0,
      subtotal: typeof line.subtotal === 'number' ? line.subtotal : 0,
    }));
  }

  private serializeId(value: unknown, context: string) {
    if (typeof value === 'string' && value.length > 0) {
      return value;
    }

    if (value && typeof value === 'object' && typeof value.toString === 'function') {
      const serialized = value.toString();
      if (serialized && serialized !== '[object Object]') {
        return serialized;
      }
    }

    throw new Error(`Invalid ${context}`);
  }

  private serializeNullableId(value: unknown, context: string) {
    if (value === null || value === undefined || value === '') {
      return null;
    }

    return this.serializeId(value, context);
  }

  private toIsoString(value?: Date | string | null) {
    if (!value) {
      return null;
    }

    return value instanceof Date ? value.toISOString() : value;
  }

  private async withBillingSummaries(
    estimates: Array<EstimateDocument | (Estimate & { _id: unknown })>,
  ) {
    if (estimates.length === 0) {
      return [];
    }

    const billingSummaryEntries = await Promise.all(
      estimates.map(async (estimate) => {
        const estimateId = String(estimate._id);
        const billingSummary =
          await this.estimateInvoiceService.getEstimateBillingSummary(estimateId);

        return [estimateId, billingSummary] as const;
      }),
    );

    const billingSummaries = new Map(billingSummaryEntries);

    return estimates.map((estimate) =>
      this.withDerivedEstimate(
        estimate,
        billingSummaries.get(String(estimate._id)),
      ),
    );
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
      before_json: this.toAuditSnapshot(input.before),
      after_json: this.toAuditSnapshot(input.after),
    });
  }

  private toAuditSnapshot(value: unknown): Record<string, unknown> | null {
    if (!value || typeof value !== 'object') {
      return null;
    }
    return value as Record<string, unknown>;
  }

  private getAdminInvoiceWorkflowSummary(
    billingSummary: EstimateBillingSummary,
  ): EstimateWorkflowSummary {
    if (
      billingSummary.invoice_status === EstimateInvoiceSnapshotStatus.STALE ||
      billingSummary.invoice_needs_refresh
    ) {
      return {
        admin_invoice_workflow_state: 'needs_resend',
        admin_invoice_workflow_title: 'Needs Resend',
        admin_invoice_workflow_detail:
          billingSummary.latest_invoice_number ?? 'Refresh required',
      };
    }

    if (
      billingSummary.invoice_status === EstimateInvoiceSnapshotStatus.ACCEPTED ||
      billingSummary.invoice_status === EstimateInvoiceSnapshotStatus.SENT
    ) {
      return {
        admin_invoice_workflow_state: 'sent',
        admin_invoice_workflow_title: 'Invoice Accepted',
        admin_invoice_workflow_detail:
          billingSummary.latest_invoice_number ??
          'Latest invoice accepted by provider',
      };
    }

    if (
      billingSummary.invoice_status === EstimateInvoiceSnapshotStatus.ISSUED &&
      !billingSummary.send_ready
    ) {
      return {
        admin_invoice_workflow_state: 'blocked',
        admin_invoice_workflow_title: 'Blocked',
        admin_invoice_workflow_detail:
          billingSummary.latest_invoice_number ?? 'Resolve billing blockers',
      };
    }

    if (
      billingSummary.invoice_status === EstimateInvoiceSnapshotStatus.ISSUED ||
      billingSummary.send_ready
    ) {
      return {
        admin_invoice_workflow_state: 'ready_to_send',
        admin_invoice_workflow_title: 'Ready to Send',
        admin_invoice_workflow_detail:
          billingSummary.latest_invoice_number ?? 'Can send invoice',
      };
    }

    return {
      admin_invoice_workflow_state: 'blocked',
      admin_invoice_workflow_title: 'Blocked',
      admin_invoice_workflow_detail: 'Needs billing details',
    };
  }

  private getDashboardOverviewEstimates(
    estimates: DashboardSummaryEstimate[],
  ) {
    const prioritizedEstimates = [
      ...estimates.filter((estimate) =>
        this.isDashboardPriorityEstimate(estimate),
      ),
      ...estimates,
    ];
    const seenEstimateIds = new Set<string>();
    const overviewEstimates: DashboardSummaryEstimate[] = [];

    for (const estimate of prioritizedEstimates) {
      const estimateId = estimate.id;
      if (seenEstimateIds.has(estimateId)) {
        continue;
      }

      seenEstimateIds.add(estimateId);
      overviewEstimates.push(estimate);

      if (overviewEstimates.length === 5) {
        break;
      }
    }

    return overviewEstimates;
  }

  private isDashboardPriorityEstimate(estimate: DashboardSummaryEstimate) {
    return (
      estimate.is_overdue ||
      (estimate.payment_status ?? PaidStatus.UNPAID) !== PaidStatus.PAID ||
      estimate.admin_invoice_workflow_state === 'ready_to_send' ||
      estimate.admin_invoice_workflow_state === 'needs_resend'
    );
  }

  private isBillingVisible(
    estimate: Pick<
      DashboardSummaryEstimate,
      'total' | 'due_date' | 'payment_status'
    >,
  ) {
    return (
      Number(estimate.total ?? 0) > 0 ||
      estimate.due_date != null ||
      (estimate.payment_status ?? PaidStatus.UNPAID) !== PaidStatus.UNPAID
    );
  }
}
