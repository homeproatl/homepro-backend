import { PaidStatus } from '../common/enums/paid-status.enum';
import { ConflictException } from '@nestjs/common';
import { Types } from 'mongoose';
import { JobStatus } from '../common/enums/job-status.enum';
import { JobsService } from './jobs.service';
import { JobInvoiceSnapshotStatus } from './enums/job-invoice-snapshot-status.enum';

describe('JobsService', () => {
  it('filters jobs list by customer and vehicle ids when provided', async () => {
    const exec = jest.fn().mockResolvedValue([
      {
        toObject: () => ({
          _id: 'job-1',
          customer_id: '507f1f77bcf86cd799439011',
          vehicle_id: '507f1f77bcf86cd799439012',
          payment_status: PaidStatus.UNPAID,
          due_date: null,
        }),
      },
    ]);
    const sort = jest.fn().mockReturnValue({ exec });
    const find = jest.fn().mockReturnValue({ sort });

    const service = new JobsService(
      { find } as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {
        getJobBillingSummary: jest.fn().mockResolvedValue({
          invoice_status: null,
          latest_invoice_number: null,
          invoice_ready: true,
          send_ready: true,
          invoice_needs_refresh: false,
        }),
      } as never,
    );

    const result = await service.findAll({
      customer_id: '507f1f77bcf86cd799439011',
      vehicle_id: '507f1f77bcf86cd799439012',
    });

    const [query] = find.mock.calls[0] as [
      {
        customer_id: { toString: () => string };
        vehicle_id: { toString: () => string };
      },
    ];

    expect(query.customer_id.toString()).toBe('507f1f77bcf86cd799439011');
    expect(query.vehicle_id.toString()).toBe('507f1f77bcf86cd799439012');
    expect(sort).toHaveBeenCalledWith({ created_at: -1 });
    expect(result[0]).toMatchObject({
      customer_id: '507f1f77bcf86cd799439011',
      vehicle_id: '507f1f77bcf86cd799439012',
      is_overdue: false,
      invoice_ready: true,
      send_ready: true,
    });
  });

  it('filters jobs list by invoice readiness, invoice status, and overdue state', async () => {
    const jobDoc = {
      _id: 'job-1',
      toObject: () => ({
        _id: 'job-1',
        customer_id: '507f1f77bcf86cd799439011',
        vehicle_id: '507f1f77bcf86cd799439012',
        payment_status: PaidStatus.UNPAID,
        due_date: new Date(Date.now() - 60_000).toISOString(),
      }),
    };
    const exec = jest.fn().mockResolvedValue([jobDoc]);
    const sort = jest.fn().mockReturnValue({ exec });
    const find = jest.fn().mockReturnValue({ sort });

    const service = new JobsService(
      { find } as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {
        getJobBillingSummary: jest.fn().mockResolvedValue({
          invoice_status: JobInvoiceSnapshotStatus.STALE,
          latest_invoice_number: 'INV-001',
          invoice_ready: true,
          send_ready: true,
          invoice_needs_refresh: true,
        }),
      } as never,
    );

    const result = await service.findAll({
      invoice_status: JobInvoiceSnapshotStatus.STALE,
      ready_to_invoice: true,
      overdue: true,
    });

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      invoice_status: JobInvoiceSnapshotStatus.STALE,
      latest_invoice_number: 'INV-001',
      invoice_ready: true,
      send_ready: true,
      invoice_needs_refresh: true,
      is_overdue: true,
      admin_invoice_workflow_state: 'needs_resend',
      admin_invoice_workflow_title: 'Needs Resend',
      admin_invoice_workflow_detail: 'INV-001',
    });
  });

  it('returns backend-derived admin invoice workflow labels on job rows', async () => {
    const exec = jest.fn().mockResolvedValue([
      {
        _id: 'job-1',
        toObject: () => ({
          _id: 'job-1',
          customer_id: '507f1f77bcf86cd799439011',
          vehicle_id: '507f1f77bcf86cd799439012',
          payment_status: PaidStatus.UNPAID,
          due_date: null,
        }),
      },
    ]);
    const sort = jest.fn().mockReturnValue({ exec });
    const find = jest.fn().mockReturnValue({ sort });

    const service = new JobsService(
      { find } as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {
        getJobBillingSummary: jest.fn().mockResolvedValue({
          invoice_status: JobInvoiceSnapshotStatus.ISSUED,
          latest_invoice_number: 'INV-777',
          invoice_ready: true,
          send_ready: true,
          invoice_needs_refresh: false,
        }),
      } as never,
    );

    await expect(service.findAll()).resolves.toMatchObject([
      {
        admin_invoice_workflow_state: 'ready_to_send',
        admin_invoice_workflow_title: 'Ready to Send',
        admin_invoice_workflow_detail: 'INV-777',
      },
    ]);
  });

  it('builds dashboard summary metrics on the backend', async () => {
    const exec = jest.fn().mockResolvedValue([
      {
        _id: 'job-ready',
        toObject: () => ({
          _id: 'job-ready',
          customer_id: 'customer-1',
          vehicle_id: 'vehicle-1',
          payment_status: PaidStatus.UNPAID,
          job_status: JobStatus.SCHEDULED,
          due_date: null,
          total: 100,
        }),
      },
      {
        _id: 'job-overdue',
        toObject: () => ({
          _id: 'job-overdue',
          customer_id: 'customer-2',
          vehicle_id: 'vehicle-2',
          payment_status: PaidStatus.UNPAID,
          job_status: JobStatus.COMPLETED,
          due_date: new Date(Date.now() - 60_000).toISOString(),
          total: 50,
        }),
      },
      {
        _id: 'job-sent',
        toObject: () => ({
          _id: 'job-sent',
          customer_id: 'customer-3',
          vehicle_id: 'vehicle-3',
          payment_status: PaidStatus.PAID,
          job_status: JobStatus.COMPLETED,
          due_date: null,
          total: 0,
        }),
      },
    ]);
    const sort = jest.fn().mockReturnValue({ exec });
    const find = jest.fn().mockReturnValue({ sort });
    const getJobBillingSummary = jest
      .fn()
      .mockImplementation((jobId: string) => {
        if (jobId === 'job-ready') {
          return {
            invoice_status: JobInvoiceSnapshotStatus.ISSUED,
            latest_invoice_number: 'INV-READY',
            invoice_ready: true,
            send_ready: true,
            invoice_needs_refresh: false,
          };
        }

        if (jobId === 'job-overdue') {
          return {
            invoice_status: JobInvoiceSnapshotStatus.STALE,
            latest_invoice_number: 'INV-STALE',
            invoice_ready: true,
            send_ready: true,
            invoice_needs_refresh: true,
          };
        }

        return {
          invoice_status: JobInvoiceSnapshotStatus.ACCEPTED,
          latest_invoice_number: 'INV-SENT',
          invoice_ready: false,
          send_ready: false,
          invoice_needs_refresh: false,
        };
      });

    const service = new JobsService(
      { find } as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      { getJobBillingSummary } as never,
    );

    await expect(service.getDashboardSummary()).resolves.toMatchObject({
      active_jobs: 1,
      ready_to_send: 1,
      overdue_billing: 1,
      unpaid_billing: 2,
      overview_jobs: [
        { _id: 'job-ready' },
        { _id: 'job-overdue' },
        { _id: 'job-sent' },
      ],
    });
  });

  it('includes billing summary fields in job detail responses', async () => {
    const jobId = new Types.ObjectId();
    const getJobBillingSummary = jest.fn().mockResolvedValue({
      invoice_status: JobInvoiceSnapshotStatus.ISSUED,
      latest_invoice_number: 'INV-404',
      invoice_ready: true,
      send_ready: false,
      invoice_needs_refresh: false,
    });
    const service = new JobsService(
      {
        findById: jest.fn().mockReturnValue({
          exec: jest.fn().mockResolvedValue({
            _id: jobId,
            customer_id: new Types.ObjectId(),
            vehicle_id: new Types.ObjectId(),
            payment_status: PaidStatus.UNPAID,
            due_date: null,
            toObject: () => ({
              _id: jobId,
              customer_id: '507f1f77bcf86cd799439011',
              vehicle_id: '507f1f77bcf86cd799439012',
              payment_status: PaidStatus.UNPAID,
              due_date: null,
            }),
          }),
        }),
      } as never,
      {
        find: jest.fn().mockReturnValue({
          exec: jest.fn().mockResolvedValue([]),
        }),
      } as never,
      {
        find: jest.fn().mockReturnValue({
          exec: jest.fn().mockResolvedValue([]),
        }),
      } as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {
        getJobBillingSummary,
      } as never,
    );

    await expect(service.findById(jobId.toString())).resolves.toMatchObject({
      invoice_status: JobInvoiceSnapshotStatus.ISSUED,
      latest_invoice_number: 'INV-404',
      invoice_ready: true,
      send_ready: false,
      invoice_needs_refresh: false,
    });
    expect(getJobBillingSummary).toHaveBeenCalledWith(jobId.toString());
  });

  it('rejects assigning a job to an inactive user during updates', async () => {
    const jobId = new Types.ObjectId();
    const customerId = new Types.ObjectId();
    const vehicleId = new Types.ObjectId();
    const inactiveUserId = new Types.ObjectId();

    const service = new JobsService(
      {
        findById: jest.fn().mockReturnValue({
          exec: jest.fn().mockResolvedValue({
            _id: jobId,
            customer_id: customerId,
            vehicle_id: vehicleId,
            assigned_user_id: null,
            scheduled_start: null,
            scheduled_end: null,
            payment_status: PaidStatus.UNPAID,
            title: 'Inspection',
            complaint_or_request: null,
            notes: null,
            payment_type: 'POS_CARD',
            due_date: null,
            save: jest.fn(),
            toObject: () => ({
              _id: jobId,
              customer_id: customerId,
              vehicle_id: vehicleId,
              assigned_user_id: null,
              payment_status: PaidStatus.UNPAID,
              due_date: null,
            }),
          }),
        }),
      } as never,
      {} as never,
      {} as never,
      {
        findById: jest.fn().mockReturnValue({
          exec: jest.fn().mockResolvedValue({
            _id: customerId,
            is_archived: false,
          }),
        }),
      } as never,
      {
        findById: jest.fn().mockReturnValue({
          exec: jest.fn().mockResolvedValue({
            _id: vehicleId,
            customer_id: customerId,
            is_archived: false,
          }),
        }),
      } as never,
      {
        findById: jest.fn().mockReturnValue({
          exec: jest.fn().mockResolvedValue({
            _id: inactiveUserId,
            is_active: false,
          }),
        }),
      } as never,
      {} as never,
      {} as never,
      {} as never,
      {
        assertValidScheduleRange: jest.fn(),
        vehicleBelongsToCustomer: jest.fn().mockReturnValue(true),
        hasAssignedUserConflict: jest.fn().mockReturnValue(false),
      } as never,
      {
        getJobBillingSummary: jest.fn().mockResolvedValue({
          invoice_status: null,
          latest_invoice_number: null,
          invoice_ready: false,
          send_ready: false,
          invoice_needs_refresh: false,
        }),
      } as never,
    );

    await expect(
      service.update(jobId.toString(), {
        assigned_user_id: inactiveUserId.toString(),
      }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('refreshes the saved service price from the catalog when a job service is reassigned', async () => {
    const jobId = new Types.ObjectId();
    const jobServiceId = new Types.ObjectId();
    const replacementServiceId = new Types.ObjectId();
    const customerId = new Types.ObjectId();
    const vehicleId = new Types.ObjectId();
    const actorUserId = new Types.ObjectId().toString();

    const line = {
      quantity: 2,
      unit_price_snapshot: 10,
      sub_total: 20,
      save: jest.fn().mockResolvedValue(undefined),
    };

    const updatedJob = {
      _id: jobId,
      customer_id: customerId,
      vehicle_id: vehicleId,
      toObject: () => ({
        _id: jobId,
        customer_id: customerId,
        vehicle_id: vehicleId,
        payment_status: PaidStatus.UNPAID,
        due_date: null,
      }),
    };

    const service = new JobsService(
      {
        findById: jest.fn().mockReturnValue({
          exec: jest.fn().mockResolvedValue({
            _id: jobId,
            toObject: () => ({ _id: jobId }),
          }),
        }),
      } as never,
      {} as never,
      {
        findOne: jest.fn().mockReturnValue({
          exec: jest.fn().mockResolvedValue(line),
        }),
      } as never,
      {} as never,
      {} as never,
      {} as never,
      {
        findById: jest.fn().mockReturnValue({
          exec: jest.fn().mockResolvedValue({
            _id: replacementServiceId,
            base_price: 75,
          }),
        }),
      } as never,
      {
        create: jest.fn().mockResolvedValue(undefined),
      } as never,
      {
        recomputeJobBillableTotal: jest.fn().mockResolvedValue(updatedJob),
      } as never,
      {
        assertVehicleBelongsToCustomer: jest.fn(),
        assertAssignedUserExists: jest.fn(),
        assertSchedule: jest.fn(),
      } as never,
      {
        markLatestSnapshotStaleIfNeeded: jest.fn().mockResolvedValue(undefined),
        getJobBillingSummary: jest.fn().mockResolvedValue({
          invoice_status: null,
          latest_invoice_number: null,
          invoice_ready: false,
          send_ready: false,
          invoice_needs_refresh: false,
        }),
      } as never,
    );

    await service.updateService(
      jobId.toString(),
      jobServiceId.toString(),
      {
        service_id: replacementServiceId.toString(),
      },
      actorUserId,
    );

    expect(line.unit_price_snapshot).toBe(75);
    expect(line.sub_total).toBe(150);
    expect(line.save).toHaveBeenCalled();
  });

  it('rejects reassigning a job line to an inactive service', async () => {
    const jobId = new Types.ObjectId();
    const jobServiceId = new Types.ObjectId();
    const replacementServiceId = new Types.ObjectId();

    const service = new JobsService(
      {
        findById: jest.fn().mockReturnValue({
          exec: jest.fn().mockResolvedValue({
            _id: jobId,
            toObject: () => ({ _id: jobId }),
          }),
        }),
      } as never,
      {} as never,
      {
        findOne: jest.fn().mockReturnValue({
          exec: jest.fn().mockResolvedValue({
            quantity: 2,
            unit_price_snapshot: 10,
            sub_total: 20,
            save: jest.fn(),
          }),
        }),
      } as never,
      {} as never,
      {} as never,
      {} as never,
      {
        findById: jest.fn().mockReturnValue({
          exec: jest.fn().mockResolvedValue({
            _id: replacementServiceId,
            is_active: false,
            base_price: 75,
          }),
        }),
      } as never,
      {
        create: jest.fn().mockResolvedValue(undefined),
      } as never,
      {
        recomputeJobBillableTotal: jest.fn(),
      } as never,
      {
        assertVehicleBelongsToCustomer: jest.fn(),
        assertAssignedUserExists: jest.fn(),
        assertSchedule: jest.fn(),
      } as never,
      {
        markLatestSnapshotStaleIfNeeded: jest.fn().mockResolvedValue(undefined),
        getJobBillingSummary: jest.fn().mockResolvedValue({
          invoice_status: null,
          latest_invoice_number: null,
          invoice_ready: false,
          send_ready: false,
          invoice_needs_refresh: false,
        }),
      } as never,
    );

    await expect(
      service.updateService(jobId.toString(), jobServiceId.toString(), {
        service_id: replacementServiceId.toString(),
      }),
    ).rejects.toThrow('Inactive services cannot be added to a job');
  });

  it('marks the latest invoice stale after payment status changes', async () => {
    const jobId = new Types.ObjectId();
    const actorUserId = new Types.ObjectId().toString();
    const save = jest.fn().mockResolvedValue(undefined);
    const markLatestSnapshotStaleIfNeeded = jest
      .fn()
      .mockResolvedValue(undefined);

    const service = new JobsService(
      {
        findById: jest.fn().mockReturnValue({
          exec: jest.fn().mockResolvedValue({
            _id: jobId,
            payment_status: PaidStatus.UNPAID,
            save,
            toObject: () => ({
              _id: jobId,
              payment_status: PaidStatus.UNPAID,
              due_date: null,
            }),
          }),
        }),
      } as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {
        create: jest.fn().mockResolvedValue(undefined),
      } as never,
      {} as never,
      {} as never,
      {
        markLatestSnapshotStaleIfNeeded,
        getJobBillingSummary: jest.fn().mockResolvedValue({
          invoice_status: null,
          latest_invoice_number: null,
          invoice_ready: false,
          send_ready: false,
          invoice_needs_refresh: false,
        }),
      } as never,
    );

    await service.updatePaymentStatus(
      jobId.toString(),
      { payment_status: PaidStatus.PAID },
      actorUserId,
    );

    expect(save).toHaveBeenCalled();
    expect(markLatestSnapshotStaleIfNeeded).toHaveBeenCalledWith(
      jobId.toString(),
    );
  });

  it('blocks job deletion when invoice history already exists', async () => {
    const jobId = new Types.ObjectId();
    const service = new JobsService(
      {
        findById: jest.fn().mockReturnValue({
          exec: jest.fn().mockResolvedValue({
            _id: jobId,
            toObject: () => ({ _id: jobId }),
          }),
        }),
      } as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {
        getInvoiceHistoryCounts: jest.fn().mockResolvedValue({
          snapshotCount: 1,
          dispatchCount: 0,
        }),
        getJobBillingSummary: jest.fn().mockResolvedValue({
          invoice_status: null,
          latest_invoice_number: null,
          invoice_ready: false,
          send_ready: false,
          invoice_needs_refresh: false,
        }),
      } as never,
    );

    await expect(service.remove(jobId.toString())).rejects.toThrow(
      'Job cannot be deleted because invoice history already exists for it.',
    );
  });

  it('deletes a job transactionally when no invoice history exists', async () => {
    const jobId = new Types.ObjectId();
    const actorUserId = new Types.ObjectId().toString();
    const deleteParts = jest.fn().mockReturnValue({
      exec: jest.fn().mockResolvedValue({ deletedCount: 2 }),
    });
    const deleteServices = jest.fn().mockReturnValue({
      exec: jest.fn().mockResolvedValue({ deletedCount: 1 }),
    });
    const deleteJob = jest.fn().mockReturnValue({
      exec: jest.fn().mockResolvedValue({ deletedCount: 1 }),
    });
    const withTransaction = jest.fn(async (work: () => Promise<void>) => {
      await work();
    });
    const endSession = jest.fn().mockResolvedValue(undefined);

    const service = new JobsService(
      {
        findById: jest.fn().mockReturnValue({
          exec: jest.fn().mockResolvedValue({
            _id: jobId,
            toObject: () => ({ _id: jobId, title: 'Inspection' }),
            payment_status: 'UNPAID',
            job_status: 'SCHEDULED',
          }),
        }),
        deleteOne: deleteJob,
        db: {
          startSession: jest.fn().mockResolvedValue({
            withTransaction,
            endSession,
          }),
        },
      } as never,
      {
        countDocuments: jest.fn().mockReturnValue({
          exec: jest.fn().mockResolvedValue(0),
        }),
        deleteMany: deleteParts,
      } as never,
      {
        countDocuments: jest.fn().mockReturnValue({
          exec: jest.fn().mockResolvedValue(0),
        }),
        deleteMany: deleteServices,
      } as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {
        create: jest.fn().mockResolvedValue(undefined),
      } as never,
      {} as never,
      {} as never,
      {
        getInvoiceHistoryCounts: jest.fn().mockResolvedValue({
          snapshotCount: 0,
          dispatchCount: 0,
        }),
        deleteInvoiceHistoryForJob: jest.fn().mockResolvedValue(undefined),
        getJobBillingSummary: jest.fn().mockResolvedValue({
          invoice_status: null,
          latest_invoice_number: null,
          invoice_ready: false,
          send_ready: false,
          invoice_needs_refresh: false,
        }),
      } as never,
    );

    await expect(
      service.remove(jobId.toString(), actorUserId),
    ).resolves.toEqual({ deleted: true });
    expect(withTransaction).toHaveBeenCalled();
    expect(deleteParts).toHaveBeenCalledWith(
      { job_id: jobId },
      expect.any(Object),
    );
    expect(deleteServices).toHaveBeenCalledWith(
      { job_id: jobId },
      expect.any(Object),
    );
    expect(deleteJob).toHaveBeenCalledWith({ _id: jobId }, expect.any(Object));
    expect(endSession).toHaveBeenCalled();
  });

  it('blocks deleting a job after work activity has started', async () => {
    const jobId = new Types.ObjectId();
    const service = new JobsService(
      {
        findById: jest.fn().mockReturnValue({
          exec: jest.fn().mockResolvedValue({
            _id: jobId,
            payment_status: 'UNPAID',
            job_status: 'CHECKED_IN',
            toObject: () => ({ _id: jobId }),
          }),
        }),
      } as never,
      {
        countDocuments: jest.fn().mockReturnValue({
          exec: jest.fn().mockResolvedValue(0),
        }),
      } as never,
      {
        countDocuments: jest.fn().mockReturnValue({
          exec: jest.fn().mockResolvedValue(0),
        }),
      } as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {
        getInvoiceHistoryCounts: jest.fn().mockResolvedValue({
          snapshotCount: 0,
          dispatchCount: 0,
        }),
        getJobBillingSummary: jest.fn().mockResolvedValue({
          invoice_status: null,
          latest_invoice_number: null,
          invoice_ready: false,
          send_ready: false,
          invoice_needs_refresh: false,
        }),
      } as never,
    );

    await expect(service.remove(jobId.toString())).rejects.toThrow(
      'Job can only be deleted before work or billing activity begins. Cancel it instead.',
    );
  });
});
