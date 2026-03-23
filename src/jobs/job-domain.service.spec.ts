import { JobStatus } from '../common/enums/job-status.enum';
import { JobDomainService } from './job-domain.service';

describe('JobDomainService', () => {
  const service = new JobDomainService();

  it('validates job schedule ranges', () => {
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
        existingJobs: [
          {
            id: 'job-1',
            assignedUserId: 'u1',
            scheduledStart: new Date('2026-01-01T09:00:00.000Z'),
            scheduledEnd: new Date('2026-01-01T10:00:00.000Z'),
            jobStatus: JobStatus.SCHEDULED,
          },
        ],
      }),
    ).toBe(true);
  });

  it('ignores completed jobs for conflicts', () => {
    expect(
      service.hasAssignedUserConflict({
        assignedUserId: 'u1',
        scheduledStart: new Date('2026-01-01T09:30:00.000Z'),
        scheduledEnd: new Date('2026-01-01T10:30:00.000Z'),
        existingJobs: [
          {
            id: 'job-1',
            assignedUserId: 'u1',
            scheduledStart: new Date('2026-01-01T09:00:00.000Z'),
            scheduledEnd: new Date('2026-01-01T10:00:00.000Z'),
            jobStatus: JobStatus.COMPLETED,
          },
        ],
      }),
    ).toBe(false);
  });

  it('enforces job status transition rules', () => {
    expect(
      service.canTransitionStatus(JobStatus.SCHEDULED, JobStatus.CHECKED_IN),
    ).toBe(true);
    expect(
      service.canTransitionStatus(JobStatus.CHECKED_IN, JobStatus.COMPLETED),
    ).toBe(true);
    expect(
      service.canTransitionStatus(JobStatus.CANCELLED, JobStatus.SCHEDULED),
    ).toBe(false);
  });
});
