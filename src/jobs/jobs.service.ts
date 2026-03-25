import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { asObjectId } from '../common/utils/object-id';
import { generateOrderId } from '../common/utils/order-id';
import { DataLayerService } from '../data-layer/data-layer.service';
import { PaidStatus } from '../common/enums/paid-status.enum';
import { PaymentType } from '../common/enums/payment-type.enum';
import { JobStatus } from '../common/enums/job-status.enum';
import { Job, JobDocument } from './schemas/job.schema';
import { JobPart, JobPartDocument } from './schemas/job-part.schema';
import { JobService, JobServiceDocument } from './schemas/job-service.schema';
import { JobInvoiceService } from './job-invoice.service';
import { JobDomainService } from './job-domain.service';
import { JobInvoiceSnapshotStatus } from './enums/job-invoice-snapshot-status.enum';
import { CreateJobDto } from './dto/create-job.dto';
import { UpdateJobDto } from './dto/update-job.dto';
import { UpdateJobStatusDto } from './dto/update-job-status.dto';
import { UpdateJobPaymentStatusDto } from './dto/update-job-payment-status.dto';
import { CreateJobPartDto } from './dto/create-job-part.dto';
import { UpdateJobPartDto } from './dto/update-job-part.dto';
import { CreateJobServiceDto } from './dto/create-job-service.dto';
import { UpdateJobServiceDto } from './dto/update-job-service.dto';
import { ListJobsQueryDto } from './dto/list-jobs-query.dto';
import {
  AuditLog,
  AuditLogDocument,
} from '../audit-logs/schemas/audit-log.schema';
import {
  Customer,
  CustomerDocument,
} from '../customers/schemas/customer.schema';
import { Vehicle, VehicleDocument } from '../vehicles/schemas/vehicle.schema';
import { User, UserDocument } from '../users/schemas/user.schema';
import {
  ServiceCatalog,
  ServiceCatalogDocument,
} from '../service-catalog/schemas/service-catalog.schema';
import {
  calculatePartSubtotal,
  calculateServiceSubtotal,
} from '../common/calculators/job-calculators';

@Injectable()
export class JobsService {
  private readonly paymentStatusTransitions: Record<PaidStatus, PaidStatus[]> =
    {
      [PaidStatus.UNPAID]: [PaidStatus.PART_PAID, PaidStatus.PAID],
      [PaidStatus.PART_PAID]: [PaidStatus.UNPAID, PaidStatus.PAID],
      [PaidStatus.PAID]: [PaidStatus.PART_PAID],
    };

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
    @InjectModel(User.name)
    private readonly userModel: Model<UserDocument>,
    @InjectModel(ServiceCatalog.name)
    private readonly serviceCatalogModel: Model<ServiceCatalogDocument>,
    @InjectModel(AuditLog.name)
    private readonly auditLogModel: Model<AuditLogDocument>,
    private readonly dataLayerService: DataLayerService,
    private readonly jobDomainService: JobDomainService,
    private readonly jobInvoiceService: JobInvoiceService,
  ) {}

  async create(payload: CreateJobDto, actorUserId?: string) {
    const created = await this.createJobWithUniqueNumber({
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
      job_status: payload.job_status,
      payment_status: payload.payment_status,
      payment_type: payload.payment_type,
      due_date: payload.due_date ? new Date(payload.due_date) : null,
    });

    await this.recordAudit({
      actorUserId,
      entityType: 'job',
      entityId: String(created._id),
      action: 'job.created',
      before: null,
      after: created.toObject(),
    });

    return this.withDerivedJob(created);
  }

  async findAll(filters: ListJobsQueryDto = {}) {
    const query: Record<string, unknown> = {};
    const defaultBillingSummary: {
      invoice_status: JobInvoiceSnapshotStatus | null;
      latest_invoice_number: string | null;
      invoice_ready: boolean;
      send_ready: boolean;
      invoice_needs_refresh: boolean;
    } = {
      invoice_status: null,
      latest_invoice_number: null,
      invoice_ready: false,
      send_ready: false,
      invoice_needs_refresh: false,
    };

    if (filters.customer_id) {
      query.customer_id = asObjectId(filters.customer_id, 'customer id');
    }

    if (filters.vehicle_id) {
      query.vehicle_id = asObjectId(filters.vehicle_id, 'vehicle id');
    }

    const jobs = await this.jobModel
      .find(query)
      .sort({ created_at: -1 })
      .exec();
    const billingSummaryEntries: Array<[string, typeof defaultBillingSummary]> =
      await Promise.all(
        jobs.map(async (job) => [
          String(job._id),
          await this.jobInvoiceService.getJobBillingSummary(String(job._id)),
        ]),
      );
    const billingSummaries = new Map<string, typeof defaultBillingSummary>(
      billingSummaryEntries,
    );

    return jobs
      .map((job) =>
        this.withDerivedJob(
          job,
          billingSummaries.get(String(job._id)) ?? defaultBillingSummary,
        ),
      )
      .filter((job) => {
        if (
          filters.invoice_status &&
          (job.invoice_status ?? 'NONE') !== filters.invoice_status
        ) {
          return false;
        }

        if (
          filters.ready_to_invoice !== undefined &&
          job.invoice_ready !== filters.ready_to_invoice
        ) {
          return false;
        }

        if (
          filters.overdue !== undefined &&
          job.is_overdue !== filters.overdue
        ) {
          return false;
        }

        return true;
      });
  }

  async findById(id: string) {
    const job = await this.jobModel.findById(asObjectId(id, 'job id')).exec();
    if (!job) {
      throw new NotFoundException('Job not found');
    }

    const [parts, services] = await Promise.all([
      this.jobPartModel.find({ job_id: job._id }).exec(),
      this.jobServiceModel.find({ job_id: job._id }).exec(),
    ]);

    return {
      ...this.withDerivedJob(job),
      parts,
      services,
    };
  }

  async remove(id: string, actorUserId?: string) {
    const job = await this.jobModel.findById(asObjectId(id, 'job id')).exec();
    if (!job) {
      throw new NotFoundException('Job not found');
    }

    const invoiceHistoryCounts =
      await this.jobInvoiceService.getInvoiceHistoryCounts(id);
    if (
      invoiceHistoryCounts.snapshotCount > 0 ||
      invoiceHistoryCounts.dispatchCount > 0
    ) {
      throw new ConflictException(
        'Job cannot be deleted because invoice history already exists for it.',
      );
    }

    const before = job.toObject();
    const session = await this.jobModel.db.startSession();

    try {
      await session.withTransaction(async () => {
        await Promise.all([
          this.jobPartModel.deleteMany({ job_id: job._id }, { session }).exec(),
          this.jobServiceModel
            .deleteMany({ job_id: job._id }, { session })
            .exec(),
          this.jobInvoiceService.deleteInvoiceHistoryForJob(id, session),
        ]);

        await this.jobModel.deleteOne({ _id: job._id }, { session }).exec();
      });
    } finally {
      await session.endSession();
    }

    await this.recordAudit({
      actorUserId,
      entityType: 'job',
      entityId: String(job._id),
      action: 'job.deleted',
      before,
      after: null,
    });

    return { deleted: true };
  }

  async update(id: string, payload: UpdateJobDto, actorUserId?: string) {
    const job = await this.jobModel.findById(asObjectId(id, 'job id')).exec();
    if (!job) {
      throw new NotFoundException('Job not found');
    }
    const before = job.toObject();

    const customerId = payload.customer_id ?? String(job.customer_id);
    const vehicleId = payload.vehicle_id ?? String(job.vehicle_id);
    const assignedUserId =
      payload.assigned_user_id === undefined
        ? job.assigned_user_id
          ? String(job.assigned_user_id)
          : null
        : payload.assigned_user_id;

    const scheduledStart =
      payload.scheduled_start === undefined
        ? job.scheduled_start
        : payload.scheduled_start
          ? new Date(payload.scheduled_start)
          : null;
    const scheduledEnd =
      payload.scheduled_end === undefined
        ? job.scheduled_end
        : payload.scheduled_end
          ? new Date(payload.scheduled_end)
          : null;

    this.jobDomainService.assertValidScheduleRange(
      scheduledStart,
      scheduledEnd,
    );

    const customer = await this.customerModel
      .findById(asObjectId(customerId, 'customer id'))
      .exec();
    if (!customer) {
      throw new NotFoundException('Customer not found');
    }

    const vehicle = await this.vehicleModel
      .findById(asObjectId(vehicleId, 'vehicle id'))
      .exec();
    if (!vehicle) {
      throw new NotFoundException('Vehicle not found');
    }

    if (
      !this.jobDomainService.vehicleBelongsToCustomer(
        String(customer._id),
        String(vehicle.customer_id),
      )
    ) {
      throw new BadRequestException('Vehicle does not belong to customer');
    }

    if (assignedUserId) {
      const user = await this.userModel
        .findById(asObjectId(assignedUserId, 'assigned user id'))
        .exec();
      if (!user) {
        throw new NotFoundException('Assigned user not found');
      }

      const existingJobs = await this.jobModel
        .find(
          {
            assigned_user_id: user._id,
            job_status: {
              $in: [
                JobStatus.SCHEDULED,
                JobStatus.CHECKED_IN,
                JobStatus.IN_PROGRESS,
              ],
            },
          },
          {
            _id: 1,
            assigned_user_id: 1,
            scheduled_start: 1,
            scheduled_end: 1,
            job_status: 1,
          },
        )
        .exec();
      const hasConflict = this.jobDomainService.hasAssignedUserConflict({
        jobId: String(job._id),
        assignedUserId: String(user._id),
        scheduledStart,
        scheduledEnd,
        existingJobs: existingJobs.map((row) => ({
          id: String(row._id),
          assignedUserId: row.assigned_user_id
            ? String(row.assigned_user_id)
            : null,
          scheduledStart: row.scheduled_start,
          scheduledEnd: row.scheduled_end,
          jobStatus: row.job_status,
        })),
      });
      if (hasConflict) {
        throw new ConflictException('Assigned user has a schedule conflict');
      }
      job.assigned_user_id = user._id;
    } else {
      job.assigned_user_id = null;
    }

    job.customer_id = customer._id;
    job.vehicle_id = vehicle._id;
    job.scheduled_start = scheduledStart;
    job.scheduled_end = scheduledEnd;

    if (payload.title !== undefined) {
      job.title = payload.title;
    }
    if (payload.complaint_or_request !== undefined) {
      job.complaint_or_request = payload.complaint_or_request;
    }
    if (payload.notes !== undefined) {
      job.notes = payload.notes;
    }
    if (payload.payment_type !== undefined) {
      job.payment_type = payload.payment_type;
    }
    if (payload.due_date !== undefined) {
      job.due_date = payload.due_date ? new Date(payload.due_date) : null;
    }

    await job.save();
    await this.recordAudit({
      actorUserId,
      entityType: 'job',
      entityId: String(job._id),
      action: 'job.updated',
      before,
      after: job.toObject(),
    });
    await this.jobInvoiceService.markLatestSnapshotStaleIfNeeded(id);

    return this.withDerivedJob(job);
  }

  async updateStatus(
    id: string,
    payload: UpdateJobStatusDto,
    actorUserId?: string,
  ) {
    const job = await this.jobModel.findById(asObjectId(id, 'job id')).exec();
    if (!job) {
      throw new NotFoundException('Job not found');
    }

    if (
      !this.jobDomainService.canTransitionStatus(
        job.job_status,
        payload.job_status,
      )
    ) {
      throw new BadRequestException(
        `Invalid job status transition from ${job.job_status} to ${payload.job_status}`,
      );
    }

    const before = job.toObject();
    job.job_status = payload.job_status;
    await job.save();

    await this.recordAudit({
      actorUserId,
      entityType: 'job',
      entityId: String(job._id),
      action: 'job.status.updated',
      before,
      after: job.toObject(),
    });

    return this.withDerivedJob(job);
  }

  async updatePaymentStatus(
    id: string,
    payload: UpdateJobPaymentStatusDto,
    actorUserId?: string,
  ) {
    const job = await this.jobModel.findById(asObjectId(id, 'job id')).exec();
    if (!job) {
      throw new NotFoundException('Job not found');
    }

    this.assertValidPaymentTransition(
      job.payment_status,
      payload.payment_status,
    );

    const before = job.toObject();
    job.payment_status = payload.payment_status;
    await job.save();
    await this.recordAudit({
      actorUserId,
      entityType: 'job',
      entityId: String(job._id),
      action: 'job.payment_status.updated',
      before,
      after: job.toObject(),
    });
    await this.jobInvoiceService.markLatestSnapshotStaleIfNeeded(id);

    return this.withDerivedJob(job);
  }

  async addPart(
    jobId: string,
    payload: CreateJobPartDto,
    actorUserId?: string,
  ) {
    const existingJob = await this.jobModel
      .findById(asObjectId(jobId, 'job id'))
      .exec();
    if (!existingJob) {
      throw new NotFoundException('Job not found');
    }
    const before = existingJob.toObject();

    await this.dataLayerService.addJobPartLine(jobId, payload);
    const updated =
      await this.dataLayerService.recomputeJobBillableTotal(jobId);
    await this.recordAudit({
      actorUserId,
      entityType: 'job',
      entityId: String(updated._id),
      action: 'job.part.added',
      before,
      after: updated.toObject(),
    });
    await this.jobInvoiceService.markLatestSnapshotStaleIfNeeded(jobId);
    return this.withDerivedJob(updated);
  }

  async updatePart(
    jobId: string,
    partId: string,
    payload: UpdateJobPartDto,
    actorUserId?: string,
  ) {
    const jobObjectId = asObjectId(jobId, 'job id');
    const existingJob = await this.jobModel.findById(jobObjectId).exec();
    if (!existingJob) {
      throw new NotFoundException('Job not found');
    }
    const before = existingJob.toObject();

    const part = await this.jobPartModel
      .findOne({
        _id: asObjectId(partId, 'job part id'),
        job_id: jobObjectId,
      })
      .exec();
    if (!part) {
      throw new NotFoundException('Job part line not found');
    }

    if (payload.part_name !== undefined) {
      part.part_name = payload.part_name;
    }
    if (payload.quantity !== undefined) {
      part.quantity = payload.quantity;
    }
    if (payload.unit_price !== undefined) {
      part.unit_price = payload.unit_price;
    }
    if (payload.cost !== undefined) {
      part.cost = payload.cost;
    }
    part.sub_total = calculatePartSubtotal(part.quantity, part.unit_price);
    await part.save();

    const updated =
      await this.dataLayerService.recomputeJobBillableTotal(jobId);
    await this.recordAudit({
      actorUserId,
      entityType: 'job',
      entityId: String(updated._id),
      action: 'job.part.updated',
      before,
      after: updated.toObject(),
    });
    await this.jobInvoiceService.markLatestSnapshotStaleIfNeeded(jobId);
    return this.withDerivedJob(updated);
  }

  async removePart(jobId: string, partId: string, actorUserId?: string) {
    const jobObjectId = asObjectId(jobId, 'job id');
    const existingJob = await this.jobModel.findById(jobObjectId).exec();
    if (!existingJob) {
      throw new NotFoundException('Job not found');
    }
    const before = existingJob.toObject();

    const deleteResult = await this.jobPartModel
      .deleteOne({
        _id: asObjectId(partId, 'job part id'),
        job_id: jobObjectId,
      })
      .exec();
    if (!deleteResult.deletedCount) {
      throw new NotFoundException('Job part line not found');
    }
    const updated =
      await this.dataLayerService.recomputeJobBillableTotal(jobId);
    await this.recordAudit({
      actorUserId,
      entityType: 'job',
      entityId: String(updated._id),
      action: 'job.part.removed',
      before,
      after: updated.toObject(),
    });
    await this.jobInvoiceService.markLatestSnapshotStaleIfNeeded(jobId);
    return this.withDerivedJob(updated);
  }

  async addService(
    jobId: string,
    payload: CreateJobServiceDto,
    actorUserId?: string,
  ) {
    const existingJob = await this.jobModel
      .findById(asObjectId(jobId, 'job id'))
      .exec();
    if (!existingJob) {
      throw new NotFoundException('Job not found');
    }
    const before = existingJob.toObject();

    await this.dataLayerService.addJobServiceLine(jobId, {
      service_id: payload.service_id,
      quantity: payload.quantity ?? 1,
    });
    const updated =
      await this.dataLayerService.recomputeJobBillableTotal(jobId);
    await this.recordAudit({
      actorUserId,
      entityType: 'job',
      entityId: String(updated._id),
      action: 'job.service.added',
      before,
      after: updated.toObject(),
    });
    await this.jobInvoiceService.markLatestSnapshotStaleIfNeeded(jobId);
    return this.withDerivedJob(updated);
  }

  async updateService(
    jobId: string,
    jobServiceId: string,
    payload: UpdateJobServiceDto,
    actorUserId?: string,
  ) {
    const jobObjectId = asObjectId(jobId, 'job id');
    const existingJob = await this.jobModel.findById(jobObjectId).exec();
    if (!existingJob) {
      throw new NotFoundException('Job not found');
    }
    const before = existingJob.toObject();

    const line = await this.jobServiceModel
      .findOne({
        _id: asObjectId(jobServiceId, 'job service id'),
        job_id: jobObjectId,
      })
      .exec();
    if (!line) {
      throw new NotFoundException('Job service line not found');
    }

    if (payload.service_id !== undefined) {
      const service = await this.serviceCatalogModel
        .findById(asObjectId(payload.service_id, 'service id'))
        .exec();
      if (!service) {
        throw new NotFoundException('Service not found');
      }
      if (service.is_active === false) {
        throw new BadRequestException(
          'Inactive services cannot be added to a job',
        );
      }
      if (service.base_price === null) {
        throw new BadRequestException(
          'Service must have a saved base price before it can be added to a job',
        );
      }
      line.service_id = service._id;
      line.unit_price_snapshot = service.base_price;
    }
    if (payload.quantity !== undefined) {
      line.quantity = payload.quantity;
    }
    line.sub_total = calculateServiceSubtotal(
      line.quantity,
      line.unit_price_snapshot,
    );
    await line.save();

    const updated =
      await this.dataLayerService.recomputeJobBillableTotal(jobId);
    await this.recordAudit({
      actorUserId,
      entityType: 'job',
      entityId: String(updated._id),
      action: 'job.service.updated',
      before,
      after: updated.toObject(),
    });
    await this.jobInvoiceService.markLatestSnapshotStaleIfNeeded(jobId);
    return this.withDerivedJob(updated);
  }

  async removeService(
    jobId: string,
    jobServiceId: string,
    actorUserId?: string,
  ) {
    const jobObjectId = asObjectId(jobId, 'job id');
    const existingJob = await this.jobModel.findById(jobObjectId).exec();
    if (!existingJob) {
      throw new NotFoundException('Job not found');
    }
    const before = existingJob.toObject();

    const deleteResult = await this.jobServiceModel
      .deleteOne({
        _id: asObjectId(jobServiceId, 'job service id'),
        job_id: jobObjectId,
      })
      .exec();
    if (!deleteResult.deletedCount) {
      throw new NotFoundException('Job service line not found');
    }

    const updated =
      await this.dataLayerService.recomputeJobBillableTotal(jobId);
    await this.recordAudit({
      actorUserId,
      entityType: 'job',
      entityId: String(updated._id),
      action: 'job.service.removed',
      before,
      after: updated.toObject(),
    });
    await this.jobInvoiceService.markLatestSnapshotStaleIfNeeded(jobId);
    return this.withDerivedJob(updated);
  }

  async calendar(filters: {
    date_from?: string;
    date_to?: string;
    assigned_user_id?: string;
    status?: JobStatus;
  }) {
    const query: Record<string, unknown> = {};
    if (filters.assigned_user_id) {
      query.assigned_user_id = asObjectId(
        filters.assigned_user_id,
        'assigned user id',
      );
    }
    if (filters.status) {
      query.job_status = filters.status;
    }
    if (filters.date_from) {
      query.scheduled_end = { $gt: new Date(filters.date_from) };
    }
    if (filters.date_to) {
      query.scheduled_start = { $lt: new Date(filters.date_to) };
    }

    const jobs = await this.jobModel
      .find(query)
      .sort({ scheduled_start: 1 })
      .exec();
    return jobs.map((job) => this.withDerivedJob(job));
  }

  async getInvoicePreview(id: string) {
    return this.jobInvoiceService.getInvoicePreview(id);
  }

  async getLatestInvoice(id: string) {
    return this.jobInvoiceService.getLatestInvoice(id);
  }

  async getInvoiceHistory(id: string) {
    return this.jobInvoiceService.getInvoiceHistory(id);
  }

  async issueInvoice(id: string, actorUserId?: string) {
    return this.jobInvoiceService.issueInvoice(id, actorUserId);
  }

  async sendInvoice(id: string, actorUserId?: string) {
    return this.jobInvoiceService.sendInvoice(id, actorUserId);
  }

  async getInvoicePdf(id: string) {
    return this.jobInvoiceService.getInvoicePdf(id);
  }

  private async createJobWithUniqueNumber(input: {
    title: string;
    customer_id: string;
    vehicle_id: string;
    scheduled_start?: Date | null;
    scheduled_end?: Date | null;
    assigned_user_id?: string | null;
    complaint_or_request?: string | null;
    notes?: string | null;
    job_status?: JobStatus;
    payment_status?: PaidStatus;
    payment_type?: PaymentType;
    due_date?: Date | null;
    total?: number;
  }) {
    const maxAttempts = 5;
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      try {
        return await this.dataLayerService.createJob({
          job_number: generateOrderId(),
          title: input.title,
          customer_id: input.customer_id,
          vehicle_id: input.vehicle_id,
          scheduled_start: input.scheduled_start ?? null,
          scheduled_end: input.scheduled_end ?? null,
          assigned_user_id: input.assigned_user_id ?? null,
          complaint_or_request: input.complaint_or_request ?? null,
          notes: input.notes ?? null,
          job_status: input.job_status,
          payment_status: input.payment_status,
          payment_type: input.payment_type,
          due_date: input.due_date ?? null,
          total: input.total ?? 0,
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
            'Could not generate a unique job number. Please retry.',
          );
        }
        throw error;
      }
    }

    throw new ConflictException('Could not generate a unique job number');
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

  private withDerivedJob(
    job: JobDocument | (Job & { _id: unknown }),
    billingSummary?: {
      invoice_status: JobInvoiceSnapshotStatus | null;
      latest_invoice_number: string | null;
      invoice_ready: boolean;
      send_ready: boolean;
      invoice_needs_refresh: boolean;
    },
  ) {
    const objectValue =
      typeof (job as JobDocument).toObject === 'function'
        ? (job as JobDocument).toObject()
        : (job as unknown as Record<string, unknown>);

    const dueDate = objectValue.due_date
      ? new Date(objectValue.due_date as string | Date)
      : null;
    const paymentStatus = objectValue.payment_status as PaidStatus;
    const isOverdue =
      !!dueDate &&
      dueDate.getTime() < Date.now() &&
      paymentStatus !== PaidStatus.PAID;

    return {
      ...objectValue,
      is_overdue: isOverdue,
      invoice_status: billingSummary?.invoice_status ?? null,
      latest_invoice_number: billingSummary?.latest_invoice_number ?? null,
      invoice_ready: billingSummary?.invoice_ready ?? false,
      send_ready: billingSummary?.send_ready ?? false,
      invoice_needs_refresh: billingSummary?.invoice_needs_refresh ?? false,
    };
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
}
