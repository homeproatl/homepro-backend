import { BadRequestException, Injectable } from '@nestjs/common';
import { JobStatus } from '../common/enums/job-status.enum';

type ConflictCheckJob = {
  id: string;
  assignedUserId: string | null;
  scheduledStart: Date | null;
  scheduledEnd: Date | null;
  jobStatus: JobStatus;
};

@Injectable()
export class JobDomainService {
  private readonly conflictRelevantStatuses = new Set<JobStatus>([
    JobStatus.SCHEDULED,
    JobStatus.CHECKED_IN,
    JobStatus.IN_PROGRESS,
  ]);

  private readonly statusTransitions: Record<JobStatus, JobStatus[]> = {
    [JobStatus.SCHEDULED]: [
      JobStatus.CHECKED_IN,
      JobStatus.IN_PROGRESS,
      JobStatus.CANCELLED,
      JobStatus.NO_SHOW,
      JobStatus.COMPLETED,
    ],
    [JobStatus.CHECKED_IN]: [
      JobStatus.IN_PROGRESS,
      JobStatus.COMPLETED,
      JobStatus.CANCELLED,
    ],
    [JobStatus.IN_PROGRESS]: [JobStatus.COMPLETED, JobStatus.CANCELLED],
    [JobStatus.COMPLETED]: [],
    [JobStatus.CANCELLED]: [],
    [JobStatus.NO_SHOW]: [],
  };

  validateScheduleRange(
    scheduledStart?: Date | null,
    scheduledEnd?: Date | null,
  ) {
    if (!scheduledStart && !scheduledEnd) {
      return true;
    }
    if (!scheduledStart || !scheduledEnd) {
      return false;
    }
    return scheduledStart.getTime() < scheduledEnd.getTime();
  }

  assertValidScheduleRange(
    scheduledStart?: Date | null,
    scheduledEnd?: Date | null,
  ) {
    if (!this.validateScheduleRange(scheduledStart, scheduledEnd)) {
      throw new BadRequestException('Invalid job schedule range');
    }
  }

  vehicleBelongsToCustomer(customerId: string, vehicleCustomerId: string) {
    return customerId === vehicleCustomerId;
  }

  canTransitionStatus(from: JobStatus, to: JobStatus) {
    if (from === to) {
      return true;
    }
    return this.statusTransitions[from].includes(to);
  }

  hasAssignedUserConflict(input: {
    jobId?: string;
    assignedUserId: string;
    scheduledStart: Date | null;
    scheduledEnd: Date | null;
    existingJobs: ConflictCheckJob[];
  }) {
    if (!input.scheduledStart || !input.scheduledEnd) {
      return false;
    }

    const { scheduledStart, scheduledEnd } = input;

    return input.existingJobs.some((job) => {
      if (job.id === input.jobId) {
        return false;
      }
      if (!job.assignedUserId || job.assignedUserId !== input.assignedUserId) {
        return false;
      }
      if (!job.scheduledStart || !job.scheduledEnd) {
        return false;
      }
      if (!this.conflictRelevantStatuses.has(job.jobStatus)) {
        return false;
      }

      return (
        scheduledStart < job.scheduledEnd && scheduledEnd > job.scheduledStart
      );
    });
  }
}
