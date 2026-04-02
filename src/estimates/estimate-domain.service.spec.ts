import { EstimateStatus } from '../common/enums/estimate-status.enum';
import { EstimateDomainService } from './estimate-domain.service';

describe('EstimateDomainService', () => {
  const service = new EstimateDomainService();

  it('validates estimate schedule ranges', () => {
    expect(
      service.validateScheduleRange(
        new Date('2026-01-01T09:00:00.000Z'),
        new Date('2026-01-01T10:00:00.000Z'),
      ),
    ).toBe(true);

    expect(
      service.validateScheduleRange(
        new Date('2026-01-01T10:00:00.000Z'),
        new Date('2026-01-01T09:00:00.000Z'),
      ),
    ).toBe(false);
  });

  it('detects assigned user schedule conflicts', () => {
    expect(
      service.hasAssignedUserConflict({
        assignedUserId: 'u1',
        scheduledStart: new Date('2026-01-01T09:30:00.000Z'),
        scheduledEnd: new Date('2026-01-01T10:30:00.000Z'),
        existingEstimates: [
          {
            id: 'estimate-1',
            assignedUserId: 'u1',
            scheduledStart: new Date('2026-01-01T09:00:00.000Z'),
            scheduledEnd: new Date('2026-01-01T10:00:00.000Z'),
            estimateStatus: EstimateStatus.SCHEDULED,
          },
        ],
      }),
    ).toBe(true);
  });

  it('ignores completed estimates for conflicts', () => {
    expect(
      service.hasAssignedUserConflict({
        assignedUserId: 'u1',
        scheduledStart: new Date('2026-01-01T09:30:00.000Z'),
        scheduledEnd: new Date('2026-01-01T10:30:00.000Z'),
        existingEstimates: [
          {
            id: 'estimate-1',
            assignedUserId: 'u1',
            scheduledStart: new Date('2026-01-01T09:00:00.000Z'),
            scheduledEnd: new Date('2026-01-01T10:00:00.000Z'),
            estimateStatus: EstimateStatus.COMPLETED,
          },
        ],
      }),
    ).toBe(false);
  });

  it('enforces estimate status transition rules', () => {
    expect(
      service.canTransitionStatus(EstimateStatus.SCHEDULED, EstimateStatus.CHECKED_IN),
    ).toBe(true);
    expect(
      service.canTransitionStatus(EstimateStatus.CHECKED_IN, EstimateStatus.COMPLETED),
    ).toBe(true);
    expect(
      service.canTransitionStatus(EstimateStatus.CANCELLED, EstimateStatus.SCHEDULED),
    ).toBe(false);
  });
});
