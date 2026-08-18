import {
  Injectable,
  Logger,
  NotFoundException,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, QueryFilter, Types } from 'mongoose';
import { UserRole } from '../common/enums/user-role.enum';
import type { AuthActor } from '../common/types/auth-actor';
import { asObjectId } from '../common/utils/object-id';
import { withOrganizationScope } from '../common/utils/organization-scope';
import { EstimateConversionService } from '../invoices/estimate-conversion.service';
import {
  DocumentAutomationJob,
  DocumentAutomationJobDocument,
} from './schemas/document-automation-job.schema';

const SYSTEM_ACTOR_USER_ID = '000000000000000000000001';

@Injectable()
export class DocumentAutomationJobService
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(DocumentAutomationJobService.name);
  private workerTimer: ReturnType<typeof setInterval> | null = null;

  constructor(
    @InjectModel(DocumentAutomationJob.name)
    private readonly jobModel: Model<DocumentAutomationJobDocument>,
    private readonly conversionService: EstimateConversionService,
  ) {}

  onModuleInit() {
    this.workerTimer = setInterval(() => {
      void this.processPendingJobs().catch((error) => {
        this.logger.warn(
          `Automation worker tick failed: ${
            error instanceof Error ? error.message : 'unknown'
          }`,
        );
      });
    }, 10_000);
    this.workerTimer.unref?.();
  }

  onModuleDestroy() {
    if (this.workerTimer) {
      clearInterval(this.workerTimer);
      this.workerTimer = null;
    }
  }

  async enqueueAutoConversionJob(estimate: {
    _id: Types.ObjectId;
    organization_id: Types.ObjectId;
    version: number;
    frozen_hash?: string | null;
    auto_generate_invoice_enabled?: boolean;
  }) {
    if (estimate.auto_generate_invoice_enabled !== true) {
      return;
    }

    try {
      await this.jobModel.create({
        organization_id: estimate.organization_id,
        estimate_id: estimate._id,
        frozen_version: estimate.version,
        frozen_hash: estimate.frozen_hash ?? `version-${estimate.version}`,
        job_type: 'convert_to_invoice',
        status: 'pending',
        attempts: 0,
        next_attempt_at: new Date(),
        last_error: null,
      });
      this.logger.log(
        `Enqueued auto-conversion job for estimate ${String(estimate._id)}`,
      );
    } catch (err: unknown) {
      if (
        typeof err === 'object' &&
        err !== null &&
        'code' in err &&
        (err as { code?: number }).code === 11000
      ) {
        this.logger.log(
          `Auto-conversion job already exists for estimate ${String(estimate._id)}`,
        );
        return;
      }
      throw err;
    }
  }

  async processPendingJobs() {
    const now = new Date();
    const leaseExpiry = new Date(now.getTime() + 5 * 60 * 1000);

    for (let i = 0; i < 10; i += 1) {
      const job = await this.claimNext(now, leaseExpiry);
      if (!job) {
        break;
      }

      try {
        const actor: AuthActor = {
          organization_id: String(job.organization_id),
          user_id: SYSTEM_ACTOR_USER_ID,
          role: UserRole.ADMIN,
          email: 'system@local',
          name: 'System',
        };

        await this.conversionService.convertToInvoice(
          String(job.estimate_id),
          undefined,
          actor,
        );

        job.status = 'completed';
        job.lease_expires_at = null;
        job.last_error = null;
        await job.save();
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        this.logger.error(
          `Auto-conversion job failed for estimate ${String(job.estimate_id)}: ${message}`,
        );
        job.status = 'failed';
        job.lease_expires_at = null;
        job.last_error = message.slice(0, 500);
        const backoffMinutes = 2 ** job.attempts;
        job.next_attempt_at = new Date(
          now.getTime() + backoffMinutes * 60 * 1000,
        );
        await job.save();
      }
    }
  }

  listForEstimate(estimateId: string, organizationId: string) {
    const filter = withOrganizationScope(organizationId, {
      estimate_id: asObjectId(estimateId, 'estimate id'),
      job_type: 'convert_to_invoice',
    }) as QueryFilter<DocumentAutomationJobDocument>;

    return this.jobModel.find(filter).sort({ created_at: -1 }).exec();
  }

  async retryFailed(jobId: string, organizationId: string) {
    const updated = await this.jobModel
      .findOneAndUpdate(
        {
          _id: asObjectId(jobId, 'job id'),
          organization_id: asObjectId(organizationId, 'organization id'),
          status: 'failed',
        },
        {
          $set: {
            status: 'pending',
            next_attempt_at: new Date(),
            lease_expires_at: null,
            last_error: null,
          },
        },
        { returnDocument: 'after' },
      )
      .exec();

    if (!updated) {
      throw new NotFoundException('Failed automation job not found');
    }
    return updated;
  }

  private claimNext(now: Date, leaseExpiry: Date) {
    return this.jobModel
      .findOneAndUpdate(
        {
          job_type: 'convert_to_invoice',
          attempts: { $lt: 5 },
          $or: [
            {
              status: { $in: ['pending', 'failed'] },
              next_attempt_at: { $lte: now },
              $and: [
                {
                  $or: [
                    { lease_expires_at: null },
                    { lease_expires_at: { $lte: now } },
                  ],
                },
              ],
            },
            // Restart-safe: reclaim abandoned processing leases.
            {
              status: 'processing',
              lease_expires_at: { $lte: now },
            },
          ],
        },
        {
          $set: {
            status: 'processing',
            lease_expires_at: leaseExpiry,
          },
          $inc: { attempts: 1 },
        },
        {
          returnDocument: 'after',
          sort: { next_attempt_at: 1, created_at: 1 },
        },
      )
      .exec();
  }
}
