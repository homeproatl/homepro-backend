import { BadRequestException, Injectable } from '@nestjs/common';
import { EstimateStatus } from '../common/enums/estimate-status.enum';

type ConflictCheckEstimate = {
  id: string;
  assignedUserId: string | null;
  scheduledStart: Date | null;
  scheduledEnd: Date | null;
  estimateStatus: EstimateStatus;
};

@Injectable()
export class EstimateDomainService {
  private readonly conflictRelevantStatuses = new Set<EstimateStatus>([
    EstimateStatus.SCHEDULED,
    EstimateStatus.CHECKED_IN,
    EstimateStatus.IN_PROGRESS,
  ]);

  private readonly statusTransitions: Record<EstimateStatus, EstimateStatus[]> = {
    [EstimateStatus.SCHEDULED]: [
      EstimateStatus.CHECKED_IN,
      EstimateStatus.IN_PROGRESS,
      EstimateStatus.CANCELLED,
      EstimateStatus.NO_SHOW,
      EstimateStatus.COMPLETED,
    ],
    [EstimateStatus.CHECKED_IN]: [
      EstimateStatus.IN_PROGRESS,
      EstimateStatus.COMPLETED,
      EstimateStatus.CANCELLED,
    ],
    [EstimateStatus.IN_PROGRESS]: [EstimateStatus.COMPLETED, EstimateStatus.CANCELLED],
    [EstimateStatus.COMPLETED]: [],
    [EstimateStatus.CANCELLED]: [],
    [EstimateStatus.NO_SHOW]: [],
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
      throw new BadRequestException('Invalid estimate schedule range');
    }
  }

  vehicleBelongsToCustomer(customerId: string, vehicleCustomerId: string) {
    return customerId === vehicleCustomerId;
  }

  canTransitionStatus(from: EstimateStatus, to: EstimateStatus) {
    if (from === to) {
      return true;
    }
    return this.statusTransitions[from].includes(to);
  }

  hasAssignedUserConflict(input: {
    estimateId?: string;
    assignedUserId: string;
    scheduledStart: Date | null;
    scheduledEnd: Date | null;
    existingEstimates: ConflictCheckEstimate[];
  }) {
    if (!input.scheduledStart || !input.scheduledEnd) {
      return false;
    }

    const { scheduledStart, scheduledEnd } = input;

    return input.existingEstimates.some((estimate) => {
      if (estimate.id === input.estimateId) {
        return false;
      }
      if (!estimate.assignedUserId || estimate.assignedUserId !== input.assignedUserId) {
        return false;
      }
      if (!estimate.scheduledStart || !estimate.scheduledEnd) {
        return false;
      }
      if (!this.conflictRelevantStatuses.has(estimate.estimateStatus)) {
        return false;
      }

      return (
        scheduledStart < estimate.scheduledEnd && scheduledEnd > estimate.scheduledStart
      );
    });
  }
}
