import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, PipelineStage } from 'mongoose';
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
import {
  resolveEstimatePaymentState,
  resolveEstimateTotals,
} from '../common/calculators/estimate-calculators';
import { serializeEmbeddedTags } from '../tags/tag-serialization';
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

type EstimatePaymentEventRecord = {
  _id?: unknown;
  amount_delta?: number;
  amount_paid_total?: number;
  amount_remaining_total?: number;
  payment_status?: PaidStatus;
  recorded_at?: Date | string | null;
  source?: string | null;
  actor_user_id?: unknown;
  note?: string | null;
};

// Dashboard rows are built from already-serialized estimate contracts.
type DashboardSummaryEstimate = {
  id: string;
  estimate_status?: EstimateStatus;
  payment_status?: PaidStatus;
  total?: number;
  amount_paid?: number;
  due_date?: string | Date | null;
  is_overdue: boolean;
  admin_invoice_workflow_state: AdminInvoiceWorkflowState;
};

type EstimateListRecord = {
  _id: unknown;
  estimate_number?: string;
  title?: string;
  customer_id: unknown;
  vehicle_id: unknown;
  scheduled_start?: Date | string | null;
  scheduled_end?: Date | string | null;
  assigned_user_id?: unknown;
  complaint_or_request?: string | null;
  notes?: string | null;
  estimate_status?: EstimateStatus;
  payment_status?: PaidStatus;
  payment_type?: PaymentType;
  amount_paid?: number;
  payment_events?: EstimatePaymentEventRecord[];
  due_date?: Date | string | null;
  labor_total?: number;
  parts_total?: number;
  subtotal?: number;
  tax_rate?: number;
  tax_amount?: number;
  total?: number;
  created_at?: Date | string | null;
  updated_at?: Date | string | null;
  services_count?: number;
  customer_name?: string | null;
  vehicle_label?: string | null;
};

type EstimateListItem = ReturnType<EstimatesService['withDerivedEstimateListItem']>;
type EstimatePageAggregateRecord = EstimateListRecord & {
  customer_first_name?: string | null;
  customer_last_name?: string | null;
  customer_email?: string | null;
  vehicle_make?: string | null;
  vehicle_model?: string | null;
  vehicle_license_plate?: string | null;
  invoice_status?: EstimateInvoiceSnapshotStatus | null;
  latest_invoice_number?: string | null;
  invoice_ready?: boolean;
  send_ready?: boolean;
  invoice_needs_refresh?: boolean;
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
    const requestedCreatedAt =
      payload.created_at === undefined ? null : new Date(payload.created_at);
    if (requestedCreatedAt && Number.isNaN(requestedCreatedAt.getTime())) {
      throw new BadRequestException('Invalid created date');
    }

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
      subtotal: payload.subtotal,
      tax_rate: payload.tax_rate,
      tax_amount: payload.tax_amount,
      total: payload.total,
      source_metadata: payload.source_metadata ?? null,
      services: payload.services,
    });

    if (requestedCreatedAt) {
      (created as unknown as { created_at: Date }).created_at =
        requestedCreatedAt;
    }
    created.amount_paid =
      created.payment_status === PaidStatus.PAID ? created.total : 0;
    this.syncPaymentState(created);
    await created.save();

    await this.recordAudit({
      actorUserId,
      entityType: 'estimate',
      entityId: String(created._id),
      action: 'estimate.created',
      before: null,
      after: created.toObject(),
    });

    return this.withBillingSummary(created);
  }

  async findAll(filters: ListEstimatesQueryDto = {}) {
    const query: Record<string, unknown> = {};

    if (filters.customer_id) {
      query.customer_id = asObjectId(filters.customer_id, 'customer id');
    }

    if (filters.vehicle_id) {
      query.vehicle_id = asObjectId(filters.vehicle_id, 'vehicle id');
    }

    return this.getFilteredEstimateList(query, filters);
  }

  async findPage(filters: ListEstimatesQueryDto = {}) {
    const query: Record<string, unknown> = {};

    if (filters.customer_id) {
      query.customer_id = asObjectId(filters.customer_id, 'customer id');
    }

    if (filters.vehicle_id) {
      query.vehicle_id = asObjectId(filters.vehicle_id, 'vehicle id');
    }

    const page = filters.page ?? 1;
    const pageSize = filters.page_size ?? 25;
    const { items, total } = await this.findPaginatedEstimateList(
      query,
      filters,
      page,
      pageSize,
    );
    const pageCount = total === 0 ? 1 : Math.ceil(total / pageSize);
    const currentPage = Math.min(page, pageCount);

    return {
      items,
      total,
      page: currentPage,
      page_size: pageSize,
      page_count: pageCount,
    };
  }

  async getDashboardSummary() {
    const estimates = (await this.findAll()) as DashboardSummaryEstimate[];
    const overviewEstimates = this.getDashboardOverviewEstimates(estimates);
    let activeJobs = 0;
    let completedJobs = 0;
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

      if (estimate.estimate_status === EstimateStatus.COMPLETED) {
        completedJobs += 1;
      }

      if (!this.isBillingVisible(estimate)) {
        continue;
      }

      if (estimate.is_overdue) {
        overdueBilling += 1;
      }

      const paymentStatus = estimate.payment_status ?? PaidStatus.UNPAID;
      const total = typeof estimate.total === 'number' ? estimate.total : 0;
      const amountPaid =
        typeof estimate.amount_paid === 'number' ? estimate.amount_paid : 0;
      const amountRemaining = Math.max(total - amountPaid, 0);

      if (
        paymentStatus === PaidStatus.UNPAID ||
        (paymentStatus === PaidStatus.PART_PAID && amountRemaining > 0)
      ) {
        unpaidBilling += 1;
      }
    }

    return {
      overview_estimates: overviewEstimates,
      active_estimates: activeJobs,
      completed_jobs: completedJobs,
      overdue_billing: overdueBilling,
      unpaid_billing: unpaidBilling,
    };
  }

  async findById(id: string) {
    const estimate = await this.estimateModel
      .findById(asObjectId(id, 'estimate id'))
      .exec();
    if (!estimate) {
      throw new NotFoundException('Estimate not found');
    }

    const [estimateWithBillingSummary] = await this.withBillingSummaries([
      estimate,
    ]);
    return estimateWithBillingSummary;
  }

  async remove(id: string, actorUserId?: string) {
    const estimate = await this.estimateModel
      .findById(asObjectId(id, 'estimate id'))
      .exec();
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
      [
        EstimateStatus.SCHEDULED,
        EstimateStatus.CANCELLED,
        EstimateStatus.NO_SHOW,
      ].includes(estimate.estimate_status);

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
        await this.estimateModel
          .deleteOne({ _id: estimate._id }, { session })
          .exec();
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
    const estimate = await this.estimateModel
      .findById(asObjectId(id, 'estimate id'))
      .exec();
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

    const nextCreatedAt =
      payload.created_at === undefined ? null : new Date(payload.created_at);
    if (nextCreatedAt && Number.isNaN(nextCreatedAt.getTime())) {
      throw new BadRequestException('Invalid created date');
    }

    const before = estimate.toObject();
    const currentServices = estimate.services.map((service) => ({
      canned_service_id: service.canned_service_id
        ? String(service.canned_service_id)
        : null,
      name: service.name,
      note: service.note ?? null,
      labor_lines: service.labor_lines.map((line) => ({
        description: line.description,
        assigned_user_id: line.assigned_user_id
          ? String(line.assigned_user_id)
          : null,
        hours: line.hours,
        rate: line.rate,
        discount_percent: line.discount_percent,
        is_completed: line.is_completed ?? false,
        tags: (line.tags ?? []).map((tag) => ({
          id: tag.tag_id ? String(tag.tag_id) : null,
          scope: 'LABOR' as const,
          name: tag.name,
          color: tag.color,
        })),
      })),
      part_lines: service.part_lines.map((line) => ({
        name: line.name,
        part_number: line.part_number ?? null,
        quantity: line.quantity,
        cost: line.cost,
        price: line.price,
        discount_percent: line.discount_percent,
        tags: (line.tags ?? []).map((tag) => ({
          id: tag.tag_id ? String(tag.tag_id) : null,
          scope: 'PART' as const,
          name: tag.name,
          color: tag.color,
        })),
      })),
    }));

    estimate.estimate_status =
      payload.estimate_status ?? estimate.estimate_status;

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
      subtotal:
        payload.subtotal === undefined
          ? payload.services === undefined
            ? estimate.subtotal
            : undefined
          : payload.subtotal,
      tax_rate:
        payload.tax_rate === undefined
          ? payload.services === undefined
            ? estimate.tax_rate
            : undefined
          : payload.tax_rate,
      tax_amount:
        payload.tax_amount === undefined
          ? payload.services === undefined
            ? estimate.tax_amount
            : undefined
          : payload.tax_amount,
      total:
        payload.total === undefined
          ? payload.services === undefined
            ? estimate.total
            : undefined
          : payload.total,
      services: payload.services ?? currentServices,
    });
    if (nextCreatedAt) {
      (estimate as unknown as { created_at: Date }).created_at = nextCreatedAt;
    }
    this.syncPaymentState(estimate);
    await estimate.save();

    await this.recordAudit({
      actorUserId,
      entityType: 'estimate',
      entityId: String(estimate._id),
      action: 'estimate.updated',
      before,
      after: estimate.toObject(),
    });
    await this.estimateInvoiceService.markLatestSnapshotStaleIfNeeded(id);

    return this.withBillingSummary(estimate);
  }

  async updateStatus(
    id: string,
    payload: UpdateEstimateStatusDto,
    actorUserId?: string,
  ) {
    const estimate = await this.estimateModel
      .findById(asObjectId(id, 'estimate id'))
      .exec();
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

    return this.withBillingSummary(estimate);
  }

  async updatePaymentStatus(
    id: string,
    payload: UpdateEstimatePaymentStatusDto,
    actorUserId?: string,
  ) {
    const estimate = await this.estimateModel
      .findById(asObjectId(id, 'estimate id'))
      .exec();
    if (!estimate) {
      throw new NotFoundException('Estimate not found');
    }

    this.assertValidPaymentTransition(
      estimate.payment_status,
      payload.payment_status,
    );

    const before = estimate.toObject();
    const total = this.resolveEstimateBillingTotal(estimate);

    const previousAmountPaid = this.resolveAmountPaid(
      estimate.amount_paid,
      total,
      estimate.payment_status ?? PaidStatus.UNPAID,
      estimate.payment_events as EstimatePaymentEventRecord[] | undefined,
    );

    if (payload.payment_status === PaidStatus.UNPAID) {
      estimate.amount_paid = 0;
    } else if (payload.payment_status === PaidStatus.PART_PAID) {
      if (typeof payload.payment_amount !== 'number') {
        throw new BadRequestException(
          'Payment amount is required when setting PART_PAID.',
        );
      }
      if (payload.payment_amount <= 0) {
        throw new BadRequestException(
          'Payment amount must be greater than 0 for PART_PAID.',
        );
      }
      if (payload.payment_amount >= total) {
        throw new BadRequestException(
          'Payment amount must be less than estimate total for PART_PAID.',
        );
      }
      estimate.amount_paid = payload.payment_amount;
    } else if (payload.payment_status === PaidStatus.PAID) {
      if (
        typeof payload.payment_amount === 'number' &&
        payload.payment_amount < total
      ) {
        throw new BadRequestException(
          'Use PART_PAID when payment amount is less than total.',
        );
      }
      estimate.amount_paid = total;
    }

    estimate.payment_status = payload.payment_status;
    this.syncPaymentState(estimate, { preferRawAmount: true });
    this.appendPaymentEvent(estimate, {
      previousAmountPaid,
      actorUserId,
      source: 'STATUS_UPDATE',
      note:
        payload.payment_status === PaidStatus.PART_PAID
          ? 'Partial payment recorded'
          : payload.payment_status === PaidStatus.PAID
            ? 'Marked paid in full'
            : 'Marked unpaid',
    });
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

    return this.withBillingSummary(estimate);
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
      .aggregate<
        EstimateListRecord & {
          customer_first_name?: string | null;
          customer_last_name?: string | null;
          vehicle_make?: string | null;
          vehicle_model?: string | null;
          vehicle_license_plate?: string | null;
        }
      >([
        { $match: query },
        {
          $lookup: {
            from: 'customers',
            localField: 'customer_id',
            foreignField: '_id',
            as: 'customer',
          },
        },
        {
          $lookup: {
            from: 'vehicles',
            localField: 'vehicle_id',
            foreignField: '_id',
            as: 'vehicle',
          },
        },
        {
          $addFields: {
            customer_first_name: {
              $let: {
                vars: { current: { $first: '$customer' } },
                in: '$$current.first_name',
              },
            },
            customer_last_name: {
              $let: {
                vars: { current: { $first: '$customer' } },
                in: '$$current.last_name',
              },
            },
            vehicle_make: {
              $let: {
                vars: { current: { $first: '$vehicle' } },
                in: '$$current.make',
              },
            },
            vehicle_model: {
              $let: {
                vars: { current: { $first: '$vehicle' } },
                in: '$$current.model',
              },
            },
            vehicle_license_plate: {
              $let: {
                vars: { current: { $first: '$vehicle' } },
                in: '$$current.license_plate',
              },
            },
          },
        },
        {
          $project: {
            customer: 0,
            vehicle: 0,
            services: 0,
            source_metadata: 0,
          },
        },
        {
          $sort: {
            scheduled_start: 1,
            created_at: 1,
          },
        },
      ])
      .exec();

    return estimates.map((estimate) =>
      this.withDerivedEstimateListItem({
        ...estimate,
        customer_name: this.buildCustomerName({
          first_name: estimate.customer_first_name ?? null,
          last_name: estimate.customer_last_name ?? null,
        }),
        vehicle_label: this.buildVehicleLabel({
          make:
            typeof estimate.vehicle_make === 'string' ? estimate.vehicle_make : '',
          model:
            typeof estimate.vehicle_model === 'string' ? estimate.vehicle_model : '',
          license_plate:
            typeof estimate.vehicle_license_plate === 'string'
              ? estimate.vehicle_license_plate
              : null,
        }),
      }),
    );
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
    subtotal?: number;
    tax_rate?: number;
    tax_amount?: number;
    total?: number;
    services: CreateEstimateDto['services'];
    source_metadata?: CreateEstimateDto['source_metadata'];
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
          subtotal: input.subtotal,
          tax_rate: input.tax_rate,
          tax_amount: input.tax_amount,
          total: input.total,
          source_metadata: input.source_metadata ?? null,
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

  private resolveAmountPaid(
    rawAmountPaid: number | undefined,
    total: number,
    paymentStatus: PaidStatus,
    paymentEvents?: EstimatePaymentEventRecord[] | undefined,
    options?: {
      preferRawAmount?: boolean;
    },
  ) {
    const latestEvent = this.resolveLatestPaymentEvent(paymentEvents);
    if (
      !options?.preferRawAmount &&
      latestEvent &&
      typeof latestEvent.amount_paid_total === 'number'
    ) {
      return resolveEstimatePaymentState({
        amount_paid: latestEvent.amount_paid_total,
        total,
        payment_status: paymentStatus,
      }).amount_paid;
    }
    return resolveEstimatePaymentState({
      amount_paid: rawAmountPaid,
      total,
      payment_status: paymentStatus,
    }).amount_paid;
  }

  private resolveLatestPaymentEvent(
    paymentEvents: EstimatePaymentEventRecord[] | undefined,
  ): EstimatePaymentEventRecord | null {
    if (!Array.isArray(paymentEvents) || paymentEvents.length === 0) {
      return null;
    }
    const sorted = [...paymentEvents].sort((a, b) => {
      const aTime = a.recorded_at ? new Date(a.recorded_at).getTime() : 0;
      const bTime = b.recorded_at ? new Date(b.recorded_at).getTime() : 0;
      return bTime - aTime;
    });
    return sorted[0] ?? null;
  }

  private resolveAmountRemaining(total: number, amountPaid: number) {
    return resolveEstimatePaymentState({
      amount_paid: amountPaid,
      total,
    }).amount_remaining;
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

    const amountRemaining = this.resolveAmountRemaining(total, amountPaid);
    if (amountRemaining === 0 && total > 0) {
      return PaidStatus.PAID;
    }
    if (amountPaid > 0) {
      return PaidStatus.PART_PAID;
    }
    return PaidStatus.UNPAID;
  }

  private syncPaymentState(
    estimate: EstimateDocument,
    options?: {
      preferRawAmount?: boolean;
    },
  ) {
    const total = this.resolveEstimateBillingTotal(estimate);
    const isLegacyPartPaidWithoutAmount =
      estimate.payment_status === PaidStatus.PART_PAID &&
      (estimate.amount_paid === undefined || estimate.amount_paid === null) &&
      total > 0;
    if (isLegacyPartPaidWithoutAmount) {
      estimate.amount_paid = 0;
      return;
    }
    const amountPaid = this.resolveAmountPaid(
      estimate.amount_paid,
      total,
      estimate.payment_status ?? PaidStatus.UNPAID,
      estimate.payment_events as EstimatePaymentEventRecord[] | undefined,
      options,
    );
    estimate.amount_paid = amountPaid;
    estimate.payment_status = this.resolvePaymentStatusFromBalance(
      total,
      amountPaid,
      estimate.payment_status ?? PaidStatus.UNPAID,
    );
  }

  private appendPaymentEvent(
    estimate: EstimateDocument,
    input: {
      previousAmountPaid: number;
      actorUserId?: string;
      source: string;
      note?: string;
    },
  ) {
    const total = this.resolveEstimateBillingTotal(estimate);
    const currentStatus = estimate.payment_status ?? PaidStatus.UNPAID;
    const currentPaymentState = resolveEstimatePaymentState({
      amount_paid: estimate.amount_paid,
      total,
      payment_status: currentStatus,
    });
    const currentAmountPaid = currentPaymentState.amount_paid;
    const previousStatus = this.resolveLatestPaymentEvent(
      estimate.payment_events as EstimatePaymentEventRecord[] | undefined,
    )?.payment_status;

    if (
      previousStatus === currentStatus &&
      Math.abs(currentAmountPaid - input.previousAmountPaid) < 0.0001
    ) {
      return;
    }

    const amountDelta = Number(
      (currentAmountPaid - input.previousAmountPaid).toFixed(2),
    );
    const event: EstimatePaymentEventRecord = {
      amount_delta: amountDelta,
      amount_paid_total: currentAmountPaid,
      amount_remaining_total: currentPaymentState.amount_remaining,
      payment_status: currentStatus,
      recorded_at: new Date(),
      source: input.source,
      actor_user_id: input.actorUserId
        ? asObjectId(input.actorUserId, 'actor user id')
        : null,
      note: input.note ?? null,
    };

    if (!Array.isArray(estimate.payment_events)) {
      estimate.payment_events = [];
    }
    estimate.payment_events.push(event as never);
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
    const estimateTotals = resolveEstimateTotals(
      {
        labor_total:
          typeof rawEstimate.labor_total === 'number'
            ? rawEstimate.labor_total
            : 0,
        parts_total:
          typeof rawEstimate.parts_total === 'number'
            ? rawEstimate.parts_total
            : 0,
        subtotal:
          typeof rawEstimate.subtotal === 'number'
            ? rawEstimate.subtotal
            : undefined,
        tax_rate:
          typeof rawEstimate.tax_rate === 'number'
            ? rawEstimate.tax_rate
            : undefined,
        tax_amount:
          typeof rawEstimate.tax_amount === 'number'
            ? rawEstimate.tax_amount
            : undefined,
        total:
          typeof rawEstimate.total === 'number'
            ? rawEstimate.total
            : undefined,
      },
      { applyDefaultTaxWhenMissing: true },
    );
    const total = estimateTotals.total;
    const rawPaymentStatus =
      (rawEstimate.payment_status as PaidStatus | undefined) ??
      PaidStatus.UNPAID;
    const amountPaid = this.resolveAmountPaid(
      rawEstimate.amount_paid as number | undefined,
      total,
      rawPaymentStatus,
      rawEstimate.payment_events as EstimatePaymentEventRecord[] | undefined,
    );
    const amountRemaining = this.resolveAmountRemaining(total, amountPaid);
    const paymentStatus = this.resolvePaymentStatusFromBalance(
      total,
      amountPaid,
      rawPaymentStatus,
    );
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
      amount_paid: amountPaid,
      amount_remaining: amountRemaining,
      payment_events: this.serializePaymentEvents(
        rawEstimate.payment_events as EstimatePaymentEventRecord[] | undefined,
      ),
      due_date: this.toIsoString(
        rawEstimate.due_date as Date | string | null | undefined,
      ),
      services: this.serializeServices(
        rawEstimate.services as Array<Record<string, unknown>> | undefined,
      ),
      source_metadata: this.serializeSourceMetadata(
        rawEstimate.source_metadata as
          | Record<string, unknown>
          | null
          | undefined,
      ),
      labor_total: estimateTotals.labor_total,
      parts_total: estimateTotals.parts_total,
      subtotal: estimateTotals.subtotal,
      tax_rate: estimateTotals.tax_rate,
      tax_amount: estimateTotals.tax_amount,
      total,
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

  private withDerivedEstimateListItem(
    rawEstimate: EstimateListRecord,
    billingSummary?: EstimateBillingSummary,
  ) {
    const dueDate = rawEstimate.due_date ? new Date(rawEstimate.due_date) : null;
    const estimateTotals = resolveEstimateTotals(
      {
        labor_total: rawEstimate.labor_total,
        parts_total: rawEstimate.parts_total,
        subtotal: rawEstimate.subtotal,
        tax_rate: rawEstimate.tax_rate,
        tax_amount: rawEstimate.tax_amount,
        total: rawEstimate.total,
      },
      { applyDefaultTaxWhenMissing: true },
    );
    const total = estimateTotals.total;
    const rawPaymentStatus =
      (rawEstimate.payment_status as PaidStatus | undefined) ??
      PaidStatus.UNPAID;
    const amountPaid = this.resolveAmountPaid(
      rawEstimate.amount_paid as number | undefined,
      total,
      rawPaymentStatus,
      rawEstimate.payment_events as EstimatePaymentEventRecord[] | undefined,
    );
    const amountRemaining = this.resolveAmountRemaining(total, amountPaid);
    const paymentStatus = this.resolvePaymentStatusFromBalance(
      total,
      amountPaid,
      rawPaymentStatus,
    );
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
      customer_name:
        typeof rawEstimate.customer_name === 'string'
          ? rawEstimate.customer_name
          : null,
      vehicle_label:
        typeof rawEstimate.vehicle_label === 'string'
          ? rawEstimate.vehicle_label
          : null,
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
      notes:
        typeof rawEstimate.notes === 'string' ? rawEstimate.notes : null,
      estimate_status: rawEstimate.estimate_status as EstimateStatus,
      payment_status: paymentStatus,
      payment_type: rawEstimate.payment_type as PaymentType,
      amount_paid: amountPaid,
      amount_remaining: amountRemaining,
      payment_events: this.serializePaymentEvents(
        rawEstimate.payment_events as EstimatePaymentEventRecord[] | undefined,
      ),
      due_date: this.toIsoString(
        rawEstimate.due_date as Date | string | null | undefined,
      ),
      labor_total: estimateTotals.labor_total,
      parts_total: estimateTotals.parts_total,
      subtotal: estimateTotals.subtotal,
      tax_rate: estimateTotals.tax_rate,
      tax_amount: estimateTotals.tax_amount,
      total,
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

  private serializePaymentEvents(
    paymentEvents?: EstimatePaymentEventRecord[] | null,
  ) {
    if (!Array.isArray(paymentEvents)) {
      return [];
    }

    return paymentEvents
      .map((event) => ({
        id: this.serializeNullableId(event._id, 'payment event id'),
        amount_delta:
          typeof event.amount_delta === 'number' ? event.amount_delta : 0,
        amount_paid_total:
          typeof event.amount_paid_total === 'number'
            ? event.amount_paid_total
            : 0,
        amount_remaining_total:
          typeof event.amount_remaining_total === 'number'
            ? event.amount_remaining_total
            : 0,
        payment_status:
          (event.payment_status as PaidStatus | undefined) ??
          PaidStatus.UNPAID,
        recorded_at: this.toIsoString(
          event.recorded_at as Date | string | null | undefined,
        ),
        source: typeof event.source === 'string' ? event.source : 'STATUS_UPDATE',
        actor_user_id: this.serializeNullableId(
          event.actor_user_id,
          'payment event actor',
        ),
        note: typeof event.note === 'string' ? event.note : null,
      }))
      .sort((a, b) => {
        const aTime = a.recorded_at ? new Date(a.recorded_at).getTime() : 0;
        const bTime = b.recorded_at ? new Date(b.recorded_at).getTime() : 0;
        return bTime - aTime;
      });
  }

  private serializeSourceMetadata(metadata?: Record<string, unknown> | null) {
    if (!metadata || typeof metadata !== 'object') {
      return null;
    }

    const stringOrNull = (value: unknown) =>
      typeof value === 'string' && value.trim().length > 0 ? value : null;

    return {
      source_system: stringOrNull(metadata.source_system) ?? 'shopmonkey',
      document_kind: stringOrNull(metadata.document_kind),
      external_order_id: stringOrNull(metadata.external_order_id),
      external_reference_number: stringOrNull(
        metadata.external_reference_number,
      ),
      external_invoice_number: stringOrNull(metadata.external_invoice_number),
      order_path: stringOrNull(metadata.order_path),
      shop_timezone: stringOrNull(metadata.shop_timezone),
      source_state_label: stringOrNull(metadata.source_state_label),
      invoice_status: stringOrNull(metadata.invoice_status),
      appointment_status: stringOrNull(metadata.appointment_status),
      created_at_shop_time: stringOrNull(metadata.created_at_shop_time),
      invoiced_at_shop_time: stringOrNull(metadata.invoiced_at_shop_time),
    };
  }

  private resolveEstimateBillingTotal(
    estimate: Pick<
      Estimate,
      'labor_total' | 'parts_total' | 'subtotal' | 'tax_rate' | 'tax_amount' | 'total'
    >,
  ) {
    return resolveEstimateTotals(
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
    ).total;
  }

  private serializeServices(services?: Array<Record<string, unknown>>) {
    return (services ?? []).map((service) => ({
      id: this.serializeId(service._id, 'estimate service id'),
      canned_service_id: this.serializeNullableId(
        service.canned_service_id,
        'canned service id',
      ),
      name: typeof service.name === 'string' ? service.name : '',
      note: typeof service.note === 'string' ? service.note : null,
      labor_lines: this.serializeLaborLines(
        service.labor_lines as Array<Record<string, unknown>> | undefined,
      ),
      part_lines: this.serializePartLines(
        service.part_lines as Array<Record<string, unknown>> | undefined,
      ),
      labor_total:
        typeof service.labor_total === 'number' ? service.labor_total : 0,
      parts_total:
        typeof service.parts_total === 'number' ? service.parts_total : 0,
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
      is_completed: Boolean(line.is_completed),
      subtotal: typeof line.subtotal === 'number' ? line.subtotal : 0,
      tags: this.serializeEmbeddedTags(
        line.tags as Array<Record<string, unknown>> | undefined,
        'LABOR',
      ),
    }));
  }

  private serializePartLines(lines?: Array<Record<string, unknown>>) {
    return (lines ?? []).map((line) => ({
      id: this.serializeId(line._id, 'estimate part line id'),
      name: typeof line.name === 'string' ? line.name : '',
      part_number:
        typeof line.part_number === 'string' &&
        line.part_number.trim().length > 0
          ? line.part_number
          : null,
      quantity: typeof line.quantity === 'number' ? line.quantity : 0,
      cost: typeof line.cost === 'number' ? line.cost : null,
      price: typeof line.price === 'number' ? line.price : 0,
      discount_percent:
        typeof line.discount_percent === 'number' ? line.discount_percent : 0,
      subtotal: typeof line.subtotal === 'number' ? line.subtotal : 0,
      tags: this.serializeEmbeddedTags(
        line.tags as Array<Record<string, unknown>> | undefined,
        'PART',
      ),
    }));
  }

  private serializeEmbeddedTags(
    lines: Array<Record<string, unknown>> | undefined,
    expectedScope: 'LABOR' | 'PART',
  ) {
    return serializeEmbeddedTags(lines, expectedScope, (value, context) =>
      this.serializeId(value, context),
    );
  }

  private serializeId(value: unknown, context: string) {
    if (typeof value === 'string' && value.length > 0) {
      return value;
    }

    if (
      value &&
      typeof value === 'object' &&
      typeof value.toString === 'function'
    ) {
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
          await this.estimateInvoiceService.getEstimateBillingSummary(
            estimateId,
          );

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

  private async withBillingSummary(
    estimate: EstimateDocument | (Estimate & { _id: unknown }),
  ) {
    const [estimateWithBillingSummary] = await this.withBillingSummaries([
      estimate,
    ]);
    return estimateWithBillingSummary;
  }

  private async withBillingSummariesForList(estimates: EstimateListRecord[]) {
    if (estimates.length === 0) {
      return [];
    }

    const billingSummaries =
      await this.estimateInvoiceService.getEstimateBillingSummariesForList(
        estimates.map((estimate) => {
          const estimateTotals = resolveEstimateTotals(
            {
              labor_total: estimate.labor_total,
              parts_total: estimate.parts_total,
              subtotal: estimate.subtotal,
              tax_rate: estimate.tax_rate,
              tax_amount: estimate.tax_amount,
              total: estimate.total,
            },
            { applyDefaultTaxWhenMissing: true },
          );

          const rawPaymentStatus =
            estimate.payment_status ?? PaidStatus.UNPAID;
          const amountPaid = this.resolveAmountPaid(
            typeof estimate.amount_paid === 'number'
              ? estimate.amount_paid
              : undefined,
            estimateTotals.total,
            rawPaymentStatus,
          );
          const paymentStatus = this.resolvePaymentStatusFromBalance(
            estimateTotals.total,
            amountPaid,
            rawPaymentStatus,
          );

          return {
            estimate_id: this.serializeId(estimate._id, 'estimate id'),
            customer_id: this.serializeId(estimate.customer_id, 'customer id'),
            total: estimateTotals.total,
            services_count:
              typeof estimate.services_count === 'number'
                ? estimate.services_count
                : 0,
            payment_status: paymentStatus,
            amount_paid: amountPaid,
          };
        }),
      );

    return estimates.map((estimate) =>
      this.withDerivedEstimateListItem(
        estimate,
        billingSummaries.get(this.serializeId(estimate._id, 'estimate id')),
      ),
    );
  }

  private async findEstimateListRecords(query: Record<string, unknown>) {
    const estimates = await this.estimateModel
      .aggregate<EstimateListRecord>([
        { $match: query },
        { $sort: { created_at: -1 } },
        {
          $project: {
            estimate_number: 1,
            title: 1,
            customer_id: 1,
            vehicle_id: 1,
            scheduled_start: 1,
            scheduled_end: 1,
            assigned_user_id: 1,
            complaint_or_request: 1,
            notes: 1,
            estimate_status: 1,
            payment_status: 1,
            payment_type: 1,
            amount_paid: 1,
            due_date: 1,
            labor_total: 1,
            parts_total: 1,
            subtotal: 1,
            tax_rate: 1,
            tax_amount: 1,
            total: 1,
            created_at: 1,
            updated_at: 1,
            services_count: {
              $size: {
                $ifNull: ['$services', []],
              },
            },
          },
        },
      ])
      .exec();

    if (estimates.length === 0) {
      return [];
    }

    const customerIds = Array.from(
      new Set(estimates.map((estimate) => this.serializeId(estimate.customer_id, 'customer id'))),
    ).map((customerId) => asObjectId(customerId, 'customer id'));
    const vehicleIds = Array.from(
      new Set(estimates.map((estimate) => this.serializeId(estimate.vehicle_id, 'vehicle id'))),
    ).map((vehicleId) => asObjectId(vehicleId, 'vehicle id'));

    const [customers, vehicles] = await Promise.all([
      this.estimateModel.db
        .collection('customers')
        .find(
          { _id: { $in: customerIds } },
          { projection: { first_name: 1, last_name: 1 } },
        )
        .toArray(),
      this.estimateModel.db
        .collection('vehicles')
        .find(
          { _id: { $in: vehicleIds } },
          { projection: { make: 1, model: 1, license_plate: 1 } },
        )
        .toArray(),
    ]);

    const customerNamesById = new Map(
      customers.map((customer) => [
        String(customer._id),
        `${typeof customer.first_name === 'string' ? customer.first_name : ''} ${
          typeof customer.last_name === 'string' ? customer.last_name : ''
        }`
          .trim() || null,
      ]),
    );
    const vehicleLabelsById = new Map(
      vehicles.map((vehicle) => [
        String(vehicle._id),
        this.buildVehicleLabel({
          make: typeof vehicle.make === 'string' ? vehicle.make : '',
          model: typeof vehicle.model === 'string' ? vehicle.model : '',
          license_plate:
            typeof vehicle.license_plate === 'string'
              ? vehicle.license_plate
              : null,
        }),
      ]),
    );

    return estimates.map((estimate) => {
      const estimateId = this.serializeId(estimate._id, 'estimate id');
      return {
        ...estimate,
        _id: estimateId,
        customer_name:
          customerNamesById.get(
            this.serializeId(estimate.customer_id, 'customer id'),
          ) ?? null,
        vehicle_label:
          vehicleLabelsById.get(
            this.serializeId(estimate.vehicle_id, 'vehicle id'),
          ) ?? null,
      };
    });
  }

  private async getFilteredEstimateList(
    query: Record<string, unknown>,
    filters: ListEstimatesQueryDto,
  ) {
    const estimates = await this.findEstimateListRecords(query);
    const estimatesWithBillingSummaries =
      await this.withBillingSummariesForList(estimates);
    const searchTerm = filters.search?.trim().toLowerCase() ?? '';
    const matchingInvoiceEstimateIds = searchTerm
      ? await this.findEstimateIdsByInvoiceSearch(searchTerm)
      : null;
    const nowMs = Date.now();
    const sorted = estimatesWithBillingSummaries
      .filter((estimate) => {
        if (filters.status && estimate.estimate_status !== filters.status) {
          return false;
        }

        if (
          filters.invoice_status &&
          (estimate.invoice_status ?? 'NONE') !== filters.invoice_status
        ) {
          return false;
        }

        if (
          filters.admin_invoice_workflow_state &&
          estimate.admin_invoice_workflow_state !==
            filters.admin_invoice_workflow_state
        ) {
          return false;
        }

        if (
          filters.ready_to_invoice !== undefined &&
          estimate.invoice_ready !== filters.ready_to_invoice
        ) {
          return false;
        }

        if (
          filters.overdue !== undefined &&
          estimate.is_overdue !== filters.overdue
        ) {
          return false;
        }

        if (!searchTerm) {
          return true;
        }

        if (matchingInvoiceEstimateIds?.has(estimate.id)) {
          return true;
        }

        const scheduleText = `${estimate.scheduled_start ?? ''} ${
          estimate.scheduled_end ?? ''
        }`;

        return [
          estimate.estimate_number,
          estimate.title,
          estimate.customer_name ?? estimate.customer_id,
          estimate.vehicle_label ?? estimate.vehicle_id,
          scheduleText,
        ]
          .join(' ')
          .toLowerCase()
          .includes(searchTerm);
      })
      .sort((left, right) =>
        this.compareEstimateListItems(
          left,
          right,
          filters.sort ?? 'newest',
          nowMs,
        ),
      );

    return sorted;
  }

  private async findPaginatedEstimateList(
    query: Record<string, unknown>,
    filters: ListEstimatesQueryDto,
    page: number,
    pageSize: number,
  ) {
    const now = new Date();
    const sendRuntimeReady =
      await this.estimateInvoiceService.isInvoiceSendRuntimeReady();
    const searchTerm = filters.search?.trim();
    const searchRegex = searchTerm
      ? new RegExp(this.escapeRegex(searchTerm), 'i')
      : null;
    const pipeline: PipelineStage[] = [
      { $match: query },
      {
        $project: {
          estimate_number: 1,
          title: 1,
          customer_id: 1,
          vehicle_id: 1,
          scheduled_start: 1,
          scheduled_end: 1,
          assigned_user_id: 1,
          complaint_or_request: 1,
          notes: 1,
          estimate_status: 1,
          payment_status: 1,
          payment_type: 1,
          due_date: 1,
          labor_total: 1,
          parts_total: 1,
          subtotal: 1,
          tax_rate: 1,
          tax_amount: 1,
          total: 1,
          created_at: 1,
          updated_at: 1,
          services_count: {
            $size: {
              $ifNull: ['$services', []],
            },
          },
        },
      },
      {
        $lookup: {
          from: 'customers',
          localField: 'customer_id',
          foreignField: '_id',
          pipeline: [
            {
              $project: {
                first_name: 1,
                last_name: 1,
                email: 1,
              },
            },
          ],
          as: 'customer',
        },
      },
      {
        $lookup: {
          from: 'vehicles',
          localField: 'vehicle_id',
          foreignField: '_id',
          pipeline: [
            {
              $project: {
                make: 1,
                model: 1,
                license_plate: 1,
              },
            },
          ],
          as: 'vehicle',
        },
      },
      {
        $lookup: {
          from: 'estimate_invoice_snapshots',
          let: { estimateId: '$_id' },
          pipeline: [
            {
              $match: {
                $expr: {
                  $eq: ['$estimate_id', '$$estimateId'],
                },
              },
            },
            {
              $sort: {
                revision_number: -1,
                created_at: -1,
              },
            },
            { $limit: 1 },
            {
              $project: {
                invoice_number: 1,
                status: 1,
              },
            },
          ],
          as: 'latest_snapshot',
        },
      },
      ...(searchRegex
        ? [
            {
              $lookup: {
                from: 'estimate_invoice_snapshots',
                let: { estimateId: '$_id' },
                pipeline: [
                  {
                    $match: {
                      $expr: {
                        $and: [
                          { $eq: ['$estimate_id', '$$estimateId'] },
                          {
                            $regexMatch: {
                              input: '$invoice_number',
                              regex: searchRegex,
                            },
                          },
                        ],
                      },
                    },
                  },
                  {
                    $project: {
                      invoice_number: 1,
                    },
                  },
                  { $limit: 1 },
                ],
                as: 'matching_invoice_snapshot',
              },
            },
          ]
        : []),
      {
        $addFields: {
          customer: { $first: '$customer' },
          vehicle: { $first: '$vehicle' },
          latest_snapshot: { $first: '$latest_snapshot' },
          ...(searchRegex
            ? {
                matching_invoice_number: {
                  $ifNull: [
                    { $first: '$matching_invoice_snapshot.invoice_number' },
                    null,
                  ],
                },
              }
            : {}),
          scheduled_start_text: {
            $cond: [
              { $ne: ['$scheduled_start', null] },
              {
                $dateToString: {
                  format: '%Y-%m-%dT%H:%M:%S.%LZ',
                  date: '$scheduled_start',
                  timezone: 'UTC',
                },
              },
              '',
            ],
          },
          scheduled_end_text: {
            $cond: [
              { $ne: ['$scheduled_end', null] },
              {
                $dateToString: {
                  format: '%Y-%m-%dT%H:%M:%S.%LZ',
                  date: '$scheduled_end',
                  timezone: 'UTC',
                },
              },
              '',
            ],
          },
        },
      },
      {
        $addFields: {
          customer_first_name: { $ifNull: ['$customer.first_name', null] },
          customer_last_name: { $ifNull: ['$customer.last_name', null] },
          customer_email: { $ifNull: ['$customer.email', null] },
          vehicle_make: { $ifNull: ['$vehicle.make', null] },
          vehicle_model: { $ifNull: ['$vehicle.model', null] },
          vehicle_license_plate: {
            $ifNull: ['$vehicle.license_plate', null],
          },
          invoice_status: { $ifNull: ['$latest_snapshot.status', null] },
          latest_invoice_number: {
            $ifNull: ['$latest_snapshot.invoice_number', null],
          },
          has_customer_email: {
            $gt: [
              {
                $strLenCP: {
                  $trim: {
                    input: { $ifNull: ['$customer.email', ''] },
                  },
                },
              },
              0,
            ],
          },
          has_billable_lines: {
            $not: {
              $and: [
                { $lte: [{ $ifNull: ['$total', 0] }, 0] },
                { $eq: [{ $ifNull: ['$services_count', 0] }, 0] },
              ],
            },
          },
          is_overdue: {
            $and: [
              { $ne: ['$due_date', null] },
              { $lt: ['$due_date', now] },
              { $ne: ['$payment_status', PaidStatus.PAID] },
            ],
          },
        },
      },
      {
        $addFields: {
          invoice_ready: {
            $and: ['$has_customer_email', '$has_billable_lines'],
          },
          invoice_needs_refresh: {
            $eq: ['$invoice_status', EstimateInvoiceSnapshotStatus.STALE],
          },
        },
      },
      {
        $addFields: {
          send_ready: {
            $and: ['$invoice_ready', sendRuntimeReady],
          },
          admin_invoice_workflow_state: {
            $switch: {
              branches: [
                {
                  case: {
                    $or: [
                      {
                        $eq: [
                          '$invoice_status',
                          EstimateInvoiceSnapshotStatus.STALE,
                        ],
                      },
                      '$invoice_needs_refresh',
                    ],
                  },
                  then: 'needs_resend',
                },
                {
                  case: {
                    $in: [
                      '$invoice_status',
                      [
                        EstimateInvoiceSnapshotStatus.ACCEPTED,
                        EstimateInvoiceSnapshotStatus.SENT,
                      ],
                    ],
                  },
                  then: 'sent',
                },
                {
                  case: {
                    $and: [
                      {
                        $eq: [
                          '$invoice_status',
                          EstimateInvoiceSnapshotStatus.ISSUED,
                        ],
                      },
                      { $not: ['$send_ready'] },
                    ],
                  },
                  then: 'blocked',
                },
                {
                  case: {
                    $or: [
                      {
                        $eq: [
                          '$invoice_status',
                          EstimateInvoiceSnapshotStatus.ISSUED,
                        ],
                      },
                      '$send_ready',
                    ],
                  },
                  then: 'ready_to_send',
                },
              ],
              default: 'blocked',
            },
          },
        },
      },
    ];

    if (filters.status) {
      pipeline.push({
        $match: {
          estimate_status: filters.status,
        },
      });
    }

    if (filters.invoice_status) {
      pipeline.push({
        $match: {
          invoice_status:
            filters.invoice_status === 'NONE' ? null : filters.invoice_status,
        },
      });
    }

    if (filters.admin_invoice_workflow_state) {
      pipeline.push({
        $match: {
          admin_invoice_workflow_state: filters.admin_invoice_workflow_state,
        },
      });
    }

    if (filters.ready_to_invoice !== undefined) {
      pipeline.push({
        $match: {
          invoice_ready: filters.ready_to_invoice,
        },
      });
    }

    if (filters.overdue !== undefined) {
      pipeline.push({
        $match: {
          is_overdue: filters.overdue,
        },
      });
    }

    if (searchRegex) {
      pipeline.push({
        $match: {
          $or: [
            { estimate_number: searchRegex },
            { latest_invoice_number: searchRegex },
            { matching_invoice_number: { $ne: null } },
            { title: searchRegex },
            { customer_first_name: searchRegex },
            { customer_last_name: searchRegex },
            { vehicle_make: searchRegex },
            { vehicle_model: searchRegex },
            { vehicle_license_plate: searchRegex },
            { scheduled_start_text: searchRegex },
            { scheduled_end_text: searchRegex },
          ],
        },
      });
    }

    if ((filters.sort ?? 'newest') === 'newest') {
      pipeline.push({
        $sort: {
          created_at: -1,
        },
      });
    } else {
      pipeline.push(
        {
          $addFields: {
            schedule_category: {
              $switch: {
                branches: [
                  {
                    case: {
                      $and: [
                        { $ne: ['$scheduled_start', null] },
                        { $ne: ['$scheduled_end', null] },
                        { $lte: ['$scheduled_start', now] },
                        { $gte: ['$scheduled_end', now] },
                      ],
                    },
                    then: 0,
                  },
                  {
                    case: {
                      $and: [
                        { $ne: ['$scheduled_start', null] },
                        { $gt: ['$scheduled_start', now] },
                      ],
                    },
                    then: 1,
                  },
                  {
                    case: {
                      $and: [
                        { $ne: ['$scheduled_start', null] },
                        { $lt: ['$scheduled_start', now] },
                      ],
                    },
                    then: 2,
                  },
                ],
                default: 3,
              },
            },
            schedule_start_ms: {
              $cond: [
                { $ne: ['$scheduled_start', null] },
                { $toLong: '$scheduled_start' },
                Number.MAX_SAFE_INTEGER,
              ],
            },
          },
        },
        {
          $addFields: {
            schedule_sort_value: {
              $cond: [
                { $eq: ['$schedule_category', 2] },
                { $multiply: ['$schedule_start_ms', -1] },
                '$schedule_start_ms',
              ],
            },
          },
        },
        {
          $sort: {
            schedule_category: 1,
            schedule_sort_value: 1,
            created_at: -1,
          },
        },
      );
    }

    pipeline.push({
      $facet: {
        metadata: [{ $count: 'total' }],
        items: [{ $skip: (page - 1) * pageSize }, { $limit: pageSize }],
      },
    });

    const [result] = await this.estimateModel
      .aggregate<{
        metadata: Array<{ total: number }>;
        items: EstimatePageAggregateRecord[];
      }>(pipeline)
      .exec();

    const total = result?.metadata[0]?.total ?? 0;
    const items = (result?.items ?? []).map((estimate) =>
      this.withDerivedEstimateListItem(
        {
          ...estimate,
          customer_name: this.buildCustomerName({
            first_name: estimate.customer_first_name ?? null,
            last_name: estimate.customer_last_name ?? null,
          }),
          vehicle_label: this.buildVehicleLabel({
            make:
              typeof estimate.vehicle_make === 'string'
                ? estimate.vehicle_make
                : '',
            model:
              typeof estimate.vehicle_model === 'string'
                ? estimate.vehicle_model
                : '',
            license_plate:
              typeof estimate.vehicle_license_plate === 'string'
                ? estimate.vehicle_license_plate
                : null,
          }),
        },
        {
          invoice_status: estimate.invoice_status ?? null,
          latest_invoice_number: estimate.latest_invoice_number ?? null,
          invoice_ready: estimate.invoice_ready === true,
          send_ready: estimate.send_ready === true,
          invoice_needs_refresh: estimate.invoice_needs_refresh === true,
        },
      ),
    );

    return { items, total };
  }

  private compareEstimateListItems(
    left: EstimateListItem,
    right: EstimateListItem,
    sortMode: 'nearest_upcoming' | 'newest',
    nowMs: number,
  ) {
    if (sortMode === 'newest') {
      const leftCreatedAt = left.created_at ? new Date(left.created_at).getTime() : 0;
      const rightCreatedAt = right.created_at ? new Date(right.created_at).getTime() : 0;
      return rightCreatedAt - leftCreatedAt;
    }

    const getScheduleCategory = (estimate: EstimateListItem) => {
      if (!estimate.scheduled_start || !estimate.scheduled_end) {
        return 3;
      }

      const startMs = new Date(estimate.scheduled_start).getTime();
      const endMs = new Date(estimate.scheduled_end).getTime();

      if (startMs <= nowMs && nowMs <= endMs) {
        return 0;
      }

      if (startMs > nowMs) {
        return 1;
      }

      return 2;
    };

    const leftCategory = getScheduleCategory(left);
    const rightCategory = getScheduleCategory(right);
    if (leftCategory !== rightCategory) {
      return leftCategory - rightCategory;
    }

    const leftStartMs = left.scheduled_start
      ? new Date(left.scheduled_start).getTime()
      : Number.POSITIVE_INFINITY;
    const rightStartMs = right.scheduled_start
      ? new Date(right.scheduled_start).getTime()
      : Number.POSITIVE_INFINITY;

    if (leftCategory === 2) {
      return rightStartMs - leftStartMs;
    }

    if (leftStartMs !== rightStartMs) {
      return leftStartMs - rightStartMs;
    }

    const leftCreatedAt = left.created_at ? new Date(left.created_at).getTime() : 0;
    const rightCreatedAt = right.created_at ? new Date(right.created_at).getTime() : 0;
    return rightCreatedAt - leftCreatedAt;
  }

  private buildVehicleLabel(vehicle: {
    make: string;
    model: string;
    license_plate: string | null;
  }) {
    const plate = vehicle.license_plate?.trim() || 'No plate';
    const makeModel = `${vehicle.make} ${vehicle.model}`.trim();
    return makeModel ? `${plate} · ${makeModel}` : plate;
  }

  private buildCustomerName(customer: {
    first_name: string | null;
    last_name: string | null;
  }) {
    const fullName = `${customer.first_name?.trim() ?? ''} ${
      customer.last_name?.trim() ?? ''
    }`.trim();
    return fullName.length > 0 ? fullName : null;
  }

  private escapeRegex(value: string) {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  private async findEstimateIdsByInvoiceSearch(searchTerm: string) {
    const searchRegex = new RegExp(this.escapeRegex(searchTerm), 'i');
    const records = await this.estimateModel.db
      .collection('estimate_invoice_snapshots')
      .find({
        invoice_number: searchRegex,
      })
      .toArray();

    return new Set(
      records.map((record) =>
        this.serializeId(
          (record as unknown as { estimate_id: unknown }).estimate_id,
          'invoice snapshot estimate id',
        ),
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
          billingSummary.latest_invoice_number
            ? `Last invoice: ${billingSummary.latest_invoice_number}`
            : 'Estimate changed after the last invoice was prepared',
      };
    }

    if (
      billingSummary.invoice_status ===
        EstimateInvoiceSnapshotStatus.ACCEPTED ||
      billingSummary.invoice_status === EstimateInvoiceSnapshotStatus.SENT
    ) {
      return {
        admin_invoice_workflow_state: 'sent',
        admin_invoice_workflow_title: 'Invoice Accepted',
        admin_invoice_workflow_detail:
          billingSummary.latest_invoice_number
            ? `Last invoice: ${billingSummary.latest_invoice_number}`
            : 'Latest invoice was accepted by the email provider',
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
          billingSummary.latest_invoice_number
            ? `Last invoice: ${billingSummary.latest_invoice_number}`
            : 'Resolve billing details before emailing',
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
          billingSummary.latest_invoice_number
            ? `Last invoice: ${billingSummary.latest_invoice_number}`
            : 'Ready to email to customer',
      };
    }

    return {
      admin_invoice_workflow_state: 'blocked',
      admin_invoice_workflow_title: 'Blocked',
      admin_invoice_workflow_detail: 'Add billing details before sending',
    };
  }

  private getDashboardOverviewEstimates(estimates: DashboardSummaryEstimate[]) {
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
