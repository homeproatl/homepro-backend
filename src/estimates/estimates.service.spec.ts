import {
  BadRequestException,
  ConflictException,
  InternalServerErrorException,
} from '@nestjs/common';
import { PaidStatus } from '../common/enums/paid-status.enum';
import { EstimateStatus } from '../common/enums/estimate-status.enum';
import { EstimateInvoiceSnapshotStatus } from './enums/estimate-invoice-snapshot-status.enum';
import { EstimatesService } from './estimates.service';

describe('EstimatesService', () => {
  function createService(overrides?: {
    estimateModel?: object;
    auditLogModel?: object;
    estimateDataService?: object;
    estimateDomainService?: object;
    estimateInvoiceService?: object;
  }) {
    return new EstimatesService(
      (overrides?.estimateModel ?? {}) as never,
      (overrides?.auditLogModel ?? { create: jest.fn() }) as never,
      (overrides?.estimateDataService ?? {}) as never,
      (overrides?.estimateDomainService ?? {
        canTransitionStatus: jest.fn().mockReturnValue(true),
      }) as never,
      (overrides?.estimateInvoiceService ?? {
        getEstimateBillingSummary: jest.fn().mockResolvedValue({
          invoice_status: null,
          latest_invoice_number: null,
          invoice_ready: true,
          send_ready: true,
          invoice_needs_refresh: false,
        }),
        getInvoiceHistoryCounts: jest.fn().mockResolvedValue({
          snapshotCount: 0,
          dispatchCount: 0,
        }),
        deleteInvoiceHistoryForEstimate: jest.fn().mockResolvedValue(undefined),
        markLatestSnapshotStaleIfNeeded: jest.fn().mockResolvedValue(undefined),
      }) as never,
    );
  }

  it('always creates new estimates in scheduled status', async () => {
    const createEstimate = jest.fn().mockResolvedValue({
      _id: 'estimate-1',
      toObject: () => ({
        _id: 'estimate-1',
        customer_id: 'customer-1',
        vehicle_id: 'vehicle-1',
        payment_status: PaidStatus.UNPAID,
        estimate_status: EstimateStatus.SCHEDULED,
        due_date: null,
        labor_total: 0,
        parts_total: 0,
        total: 0,
      }),
    });

    const service = createService({
      estimateDataService: {
        createEstimate,
      },
    });

    await service.create({
      title: 'Brake Estimate',
      customer_id: 'customer-1',
      vehicle_id: 'vehicle-1',
      estimate_status: EstimateStatus.COMPLETED,
      services: [
        {
          name: 'Brake Service',
          labor_lines: [],
          part_lines: [],
        },
      ],
    } as never);

    expect(createEstimate).toHaveBeenCalledWith(
      expect.objectContaining({
        estimate_status: EstimateStatus.SCHEDULED,
      }),
    );
  });

  it('filters estimates list by customer and vehicle ids when provided', async () => {
    const exec = jest.fn().mockResolvedValue([
      {
        _id: 'estimate-1',
        toObject: () => ({
          _id: 'estimate-1',
          customer_id: '507f1f77bcf86cd799439011',
          vehicle_id: '507f1f77bcf86cd799439012',
          payment_status: PaidStatus.UNPAID,
          due_date: null,
          labor_total: 100,
          parts_total: 50,
          total: 150,
        }),
      },
    ]);
    const sort = jest.fn().mockReturnValue({ exec });
    const find = jest.fn().mockReturnValue({ sort });

    const service = createService({
      estimateModel: { find },
    });

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
    expect(result[0]).toMatchObject({
      id: 'estimate-1',
      customer_id: '507f1f77bcf86cd799439011',
      vehicle_id: '507f1f77bcf86cd799439012',
      total: 150,
      invoice_ready: true,
      send_ready: true,
    });
    expect(result[0]).not.toHaveProperty('_id');
  });

  it('returns backend-derived admin invoice workflow labels on estimate rows', async () => {
    const exec = jest.fn().mockResolvedValue([
      {
        _id: 'estimate-1',
        toObject: () => ({
          _id: 'estimate-1',
          customer_id: 'customer-1',
          vehicle_id: 'vehicle-1',
          payment_status: PaidStatus.UNPAID,
          due_date: null,
          labor_total: 0,
          parts_total: 0,
          total: 0,
        }),
      },
    ]);
    const sort = jest.fn().mockReturnValue({ exec });
    const find = jest.fn().mockReturnValue({ sort });

    const service = createService({
      estimateModel: { find },
      estimateInvoiceService: {
        getEstimateBillingSummary: jest.fn().mockResolvedValue({
          invoice_status: EstimateInvoiceSnapshotStatus.ISSUED,
          latest_invoice_number: 'INV-777',
          invoice_ready: true,
          send_ready: true,
          invoice_needs_refresh: false,
        }),
      },
    });

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
        _id: 'estimate-ready',
        toObject: () => ({
          _id: 'estimate-ready',
          customer_id: 'customer-1',
          vehicle_id: 'vehicle-1',
          payment_status: PaidStatus.UNPAID,
          estimate_status: EstimateStatus.SCHEDULED,
          due_date: null,
          labor_total: 100,
          parts_total: 0,
          total: 100,
        }),
      },
      {
        _id: 'estimate-overdue',
        toObject: () => ({
          _id: 'estimate-overdue',
          customer_id: 'customer-2',
          vehicle_id: 'vehicle-2',
          payment_status: PaidStatus.UNPAID,
          estimate_status: EstimateStatus.COMPLETED,
          due_date: new Date(Date.now() - 60_000).toISOString(),
          labor_total: 0,
          parts_total: 50,
          total: 50,
        }),
      },
    ]);
    const sort = jest.fn().mockReturnValue({ exec });
    const find = jest.fn().mockReturnValue({ sort });
    const getEstimateBillingSummary = jest
      .fn()
      .mockImplementation((estimateId: string) => {
      if (estimateId === 'estimate-ready') {
        return {
          invoice_status: EstimateInvoiceSnapshotStatus.ISSUED,
          latest_invoice_number: 'INV-READY',
          invoice_ready: true,
          send_ready: true,
          invoice_needs_refresh: false,
        };
      }

      return {
        invoice_status: EstimateInvoiceSnapshotStatus.STALE,
        latest_invoice_number: 'INV-STALE',
        invoice_ready: true,
        send_ready: true,
        invoice_needs_refresh: true,
      };
    });

    const service = createService({
      estimateModel: { find },
      estimateInvoiceService: { getEstimateBillingSummary },
    });

    await expect(service.getDashboardSummary()).resolves.toMatchObject({
      active_estimates: 1,
      ready_to_send: 1,
      overdue_billing: 1,
      unpaid_billing: 2,
    });
  });

  it('prevents deleting estimates that already have grouped service activity', async () => {
    const estimate = {
      _id: '507f1f77bcf86cd799439011',
      estimate_status: EstimateStatus.SCHEDULED,
      payment_status: PaidStatus.UNPAID,
      services: [{ id: 'service-1' }],
      toObject: jest.fn().mockReturnValue({
        _id: '507f1f77bcf86cd799439011',
      }),
    };

    const service = createService({
      estimateModel: {
        findById: jest.fn().mockReturnValue({
          exec: jest.fn().mockResolvedValue(estimate),
        }),
      },
    });

    await expect(
      service.remove('507f1f77bcf86cd799439011'),
    ).rejects.toThrow(ConflictException);
  });

  it('persists estimate status changes through the grouped update flow', async () => {
    const save = jest.fn().mockResolvedValue(undefined);
    const estimate = {
      _id: '507f1f77bcf86cd799439011',
      title: 'Oil Service',
      customer_id: '507f1f77bcf86cd799439012',
      vehicle_id: '507f1f77bcf86cd799439013',
      assigned_user_id: null,
      complaint_or_request: null,
      notes: null,
      payment_type: 'POS_CARD',
      due_date: null,
      estimate_status: EstimateStatus.SCHEDULED,
      payment_status: PaidStatus.UNPAID,
      services: [],
      toObject: jest.fn().mockImplementation(() => ({
        _id: estimate._id,
        estimate_number: 'EST-100',
        title: estimate.title,
        customer_id: estimate.customer_id,
        vehicle_id: estimate.vehicle_id,
        assigned_user_id: estimate.assigned_user_id,
        complaint_or_request: estimate.complaint_or_request,
        notes: estimate.notes,
        payment_type: estimate.payment_type,
        due_date: estimate.due_date,
        estimate_status: estimate.estimate_status,
        payment_status: estimate.payment_status,
        services: estimate.services,
        labor_total: 0,
        parts_total: 0,
        total: 0,
        created_at: new Date('2026-04-03T08:00:00.000Z'),
        updated_at: new Date('2026-04-03T08:30:00.000Z'),
      })),
      save,
    };
    const applyEstimateUpdate = jest.fn().mockResolvedValue(estimate);

    const service = createService({
      estimateModel: {
        findById: jest.fn().mockReturnValue({
          exec: jest.fn().mockResolvedValue(estimate),
        }),
      },
      estimateDataService: {
        applyEstimateUpdate,
      },
    });

    await service.update('507f1f77bcf86cd799439011', {
      estimate_status: EstimateStatus.IN_PROGRESS,
    });

    expect(estimate.estimate_status).toBe(EstimateStatus.IN_PROGRESS);
    expect(applyEstimateUpdate).toHaveBeenCalled();
  });

  it('rejects invalid estimate status transitions through the grouped update flow', async () => {
    const service = createService({
      estimateModel: {
        findById: jest.fn().mockReturnValue({
          exec: jest.fn().mockResolvedValue({
            _id: '507f1f77bcf86cd799439011',
            title: 'Oil Service',
            customer_id: '507f1f77bcf86cd799439012',
            vehicle_id: '507f1f77bcf86cd799439013',
            assigned_user_id: null,
            complaint_or_request: null,
            notes: null,
            payment_type: 'POS_CARD',
            due_date: null,
            estimate_status: EstimateStatus.SCHEDULED,
            payment_status: PaidStatus.UNPAID,
            services: [],
            toObject: jest.fn().mockReturnValue({
              _id: '507f1f77bcf86cd799439011',
            }),
          }),
        }),
      },
      estimateDomainService: {
        canTransitionStatus: jest.fn().mockReturnValue(false),
      },
    });

    await expect(
      service.update('507f1f77bcf86cd799439011', {
        estimate_status: EstimateStatus.COMPLETED,
      }),
    ).rejects.toThrow(BadRequestException);
  });

  it('preserves labor-line technician assignments when updating without replacing services', async () => {
    const applyEstimateUpdate = jest.fn().mockResolvedValue(undefined);
    const estimate = {
      _id: '507f1f77bcf86cd799439011',
      title: 'Oil Service',
      customer_id: '507f1f77bcf86cd799439012',
      vehicle_id: '507f1f77bcf86cd799439013',
      assigned_user_id: null,
      complaint_or_request: null,
      notes: null,
      payment_type: 'POS_CARD',
      due_date: null,
      estimate_status: EstimateStatus.SCHEDULED,
      payment_status: PaidStatus.UNPAID,
      services: [
        {
          _id: 'estimate-service-1',
          canned_service_id: 'service-1',
          name: 'Oil Change',
          labor_lines: [
            {
              _id: 'labor-line-1',
              description: 'Oil labor',
              assigned_user_id: 'tech-1',
              hours: 1,
              rate: 100,
              discount_percent: 0,
            },
          ],
          part_lines: [],
        },
      ],
      toObject: jest.fn().mockReturnValue({
        _id: '507f1f77bcf86cd799439011',
        estimate_number: 'EST-101',
        title: 'Oil Service',
        customer_id: '507f1f77bcf86cd799439012',
        vehicle_id: '507f1f77bcf86cd799439013',
        assigned_user_id: null,
        complaint_or_request: null,
        notes: null,
        payment_type: 'POS_CARD',
        due_date: null,
        estimate_status: EstimateStatus.SCHEDULED,
        payment_status: PaidStatus.UNPAID,
        services: [
          {
            _id: 'estimate-service-1',
            canned_service_id: 'service-1',
            name: 'Oil Change',
            labor_lines: [
              {
                _id: 'labor-line-1',
                description: 'Oil labor',
                assigned_user_id: 'tech-1',
                hours: 1,
                rate: 100,
                discount_percent: 0,
                subtotal: 100,
              },
            ],
            part_lines: [],
            labor_total: 100,
            parts_total: 0,
            total: 100,
          },
        ],
        labor_total: 100,
        parts_total: 0,
        total: 100,
        created_at: new Date('2026-04-03T08:00:00.000Z'),
        updated_at: new Date('2026-04-03T08:30:00.000Z'),
      }),
    };

    const service = createService({
      estimateModel: {
        findById: jest.fn().mockReturnValue({
          exec: jest.fn().mockResolvedValue(estimate),
        }),
      },
      estimateDataService: {
        applyEstimateUpdate,
      },
    });

    await service.update('507f1f77bcf86cd799439011', {
      title: 'Oil Service Updated',
    });

    expect(applyEstimateUpdate).toHaveBeenCalledWith(
      estimate,
      expect.objectContaining({
        services: [
          expect.objectContaining({
            labor_lines: [
              expect.objectContaining({
                assigned_user_id: 'tech-1',
              }),
            ],
          }),
        ],
      }),
    );
  });

  it('fails serialization when stored estimate tag scope does not match the line type', () => {
    const service = createService();

    expect(() =>
      (service as never as {
        serializeEmbeddedTags: (
          lines: Array<Record<string, unknown>> | undefined,
          expectedScope: 'LABOR' | 'PART',
        ) => unknown;
      }).serializeEmbeddedTags(
        [{ tag_id: null, scope: 'PART', name: 'Priority', color: 'red' }],
        'LABOR',
      ),
    ).toThrow(InternalServerErrorException);
  });
});
