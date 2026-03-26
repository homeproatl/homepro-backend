import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import {
  Customer,
  CustomerDocument,
} from '../customers/schemas/customer.schema';
import { User, UserDocument } from '../users/schemas/user.schema';
import { Vehicle, VehicleDocument } from '../vehicles/schemas/vehicle.schema';
import {
  calculateJobBillableTotal,
  calculatePartSubtotal,
  calculatePartsTotal,
  calculateServiceSubtotal,
  calculateServicesTotal,
} from '../common/calculators/job-calculators';
import { ServiceCatalogDocument } from '../service-catalog/schemas/service-catalog.schema';
import { ServiceCatalog } from '../service-catalog/schemas/service-catalog.schema';
import { PaidStatus } from '../common/enums/paid-status.enum';
import { PaymentType } from '../common/enums/payment-type.enum';
import { Job, JobDocument } from './schemas/job.schema';
import { JobStatus } from '../common/enums/job-status.enum';
import { JobPart, JobPartDocument } from './schemas/job-part.schema';
import { JobService, JobServiceDocument } from './schemas/job-service.schema';
import { JobDomainService } from './job-domain.service';

type ObjectIdLike = Types.ObjectId | string;

@Injectable()
export class JobDataService {
  constructor(
    @InjectModel(Customer.name)
    private readonly customerModel: Model<CustomerDocument>,
    @InjectModel(Vehicle.name)
    private readonly vehicleModel: Model<VehicleDocument>,
    @InjectModel(User.name)
    private readonly userModel: Model<UserDocument>,
    @InjectModel(ServiceCatalog.name)
    private readonly serviceModel: Model<ServiceCatalogDocument>,
    @InjectModel(Job.name)
    private readonly jobModel: Model<JobDocument>,
    @InjectModel(JobPart.name)
    private readonly jobPartModel: Model<JobPartDocument>,
    @InjectModel(JobService.name)
    private readonly jobServiceModel: Model<JobServiceDocument>,
    private readonly jobDomainService: JobDomainService,
  ) {}

  async createJob(input: {
    job_number: string;
    title: string;
    customer_id: ObjectIdLike;
    vehicle_id: ObjectIdLike;
    scheduled_start?: Date | null;
    scheduled_end?: Date | null;
    assigned_user_id?: ObjectIdLike | null;
    complaint_or_request?: string | null;
    notes?: string | null;
    job_status?: JobStatus;
    payment_status?: PaidStatus;
    payment_type?: PaymentType;
    due_date?: Date | null;
    total?: number;
  }) {
    const customer = await this.customerModel
      .findById(input.customer_id)
      .exec();
    if (!customer) {
      throw new NotFoundException('Customer not found');
    }
    if (customer.is_archived === true) {
      throw new BadRequestException(
        'Archived customers cannot be assigned to new jobs.',
      );
    }

    const vehicle = await this.vehicleModel.findById(input.vehicle_id).exec();
    if (!vehicle) {
      throw new NotFoundException('Vehicle not found');
    }
    if (vehicle.is_archived === true) {
      throw new BadRequestException(
        'Archived vehicles cannot be assigned to new jobs.',
      );
    }

    if (
      !this.jobDomainService.vehicleBelongsToCustomer(
        String(customer._id),
        String(vehicle.customer_id),
      )
    ) {
      throw new BadRequestException('Vehicle does not belong to customer');
    }

    const scheduledStart = input.scheduled_start ?? null;
    const scheduledEnd = input.scheduled_end ?? null;
    this.jobDomainService.assertValidScheduleRange(
      scheduledStart,
      scheduledEnd,
    );

    if (input.assigned_user_id) {
      const assignedUser = await this.userModel
        .findById(input.assigned_user_id)
        .exec();
      if (!assignedUser) {
        throw new NotFoundException('Assigned user not found');
      }
      if (!assignedUser.is_active) {
        throw new ConflictException('Assigned user is inactive');
      }

      const existingJobs = await this.jobModel
        .find(
          {
            assigned_user_id: assignedUser._id,
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
        assignedUserId: String(assignedUser._id),
        scheduledStart,
        scheduledEnd,
        existingJobs: existingJobs.map((job) => ({
          id: String(job._id),
          assignedUserId: job.assigned_user_id
            ? String(job.assigned_user_id)
            : null,
          scheduledStart: job.scheduled_start,
          scheduledEnd: job.scheduled_end,
          jobStatus: job.job_status,
        })),
      });

      if (hasConflict) {
        throw new ConflictException('Assigned user has a schedule conflict');
      }
    }

    return this.jobModel.create({
      job_number: input.job_number,
      title: input.title,
      customer_id: customer._id,
      vehicle_id: vehicle._id,
      scheduled_start: scheduledStart,
      scheduled_end: scheduledEnd,
      assigned_user_id: input.assigned_user_id ?? null,
      complaint_or_request: input.complaint_or_request ?? null,
      notes: input.notes ?? null,
      job_status: input.job_status ?? JobStatus.SCHEDULED,
      payment_status: input.payment_status ?? PaidStatus.UNPAID,
      payment_type: input.payment_type ?? PaymentType.POS_CARD,
      due_date: input.due_date ?? null,
      total: input.total ?? 0,
    });
  }

  async addJobPartLine(
    jobId: ObjectIdLike,
    input: {
      part_name: string;
      quantity: number;
      unit_price: number;
      cost?: number | null;
    },
  ) {
    const job = await this.jobModel.findById(jobId).exec();
    if (!job) {
      throw new NotFoundException('Job not found');
    }

    const subTotal = calculatePartSubtotal(input.quantity, input.unit_price);
    return this.jobPartModel.create({
      job_id: job._id,
      part_name: input.part_name,
      quantity: input.quantity,
      unit_price: input.unit_price,
      cost: input.cost ?? null,
      sub_total: subTotal,
    });
  }

  async addJobServiceLine(
    jobId: ObjectIdLike,
    input: {
      service_id: ObjectIdLike;
      quantity: number;
    },
  ) {
    const session = await this.jobModel.db.startSession();

    try {
      let createdLine: JobServiceDocument | null = null;

      await session.withTransaction(async () => {
        const job = await this.jobModel.findById(jobId).session(session).exec();
        if (!job) {
          throw new NotFoundException('Job not found');
        }

        const service = await this.serviceModel
          .findOneAndUpdate(
            {
              _id: input.service_id,
              is_active: { $ne: false },
              base_price: { $ne: null },
            },
            { $inc: { __v: 1 } },
            {
              returnDocument: 'after',
              session,
              timestamps: false,
            },
          )
          .exec();

        if (!service) {
          const existingService = await this.serviceModel
            .findById(input.service_id)
            .session(session)
            .exec();

          if (!existingService) {
            throw new NotFoundException('Service not found');
          }

          if (existingService.is_active === false) {
            throw new BadRequestException(
              'Inactive services cannot be added to a job',
            );
          }

          throw new BadRequestException(
            'Service must have a saved base price before it can be added to a job',
          );
        }

        const subTotal = calculateServiceSubtotal(
          input.quantity,
          service.base_price as number,
        );

        const line = new this.jobServiceModel({
          job_id: job._id,
          service_id: service._id,
          quantity: input.quantity,
          unit_price_snapshot: service.base_price as number,
          sub_total: subTotal,
        });
        await line.save({ session });
        createdLine = line;
      });

      if (!createdLine) {
        throw new BadRequestException('Unable to add service line to the job');
      }

      return createdLine;
    } finally {
      await session.endSession();
    }
  }

  async recomputeJobBillableTotal(jobId: ObjectIdLike) {
    const job = await this.jobModel.findById(jobId).exec();
    if (!job) {
      throw new NotFoundException('Job not found');
    }

    const [parts, services] = await Promise.all([
      this.jobPartModel.find({ job_id: job._id }).exec(),
      this.jobServiceModel.find({ job_id: job._id }).exec(),
    ]);

    const partsBillableTotal = calculatePartsTotal(
      parts.map((part) => ({
        quantity: part.quantity,
        unitPrice: part.unit_price,
      })),
    );
    const servicesBillableTotal = calculateServicesTotal(
      services.map((service) => ({
        quantity: service.quantity,
        unitPriceSnapshot: service.unit_price_snapshot,
      })),
    );

    job.total = calculateJobBillableTotal({
      partsBillableTotal,
      servicesBillableTotal,
    });
    await job.save();

    return job;
  }
}
