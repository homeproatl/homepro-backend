import { PaidStatus } from '../common/enums/paid-status.enum';
import { Types } from 'mongoose';
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
      invoice_needs_refresh: true,
      is_overdue: true,
    });
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
});
