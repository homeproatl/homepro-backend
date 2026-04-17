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
  function createListEstimateModel(records: Array<Record<string, unknown>>) {
    const aggregateExec = jest.fn().mockResolvedValue(records);
    const aggregate = jest.fn().mockReturnValue({ exec: aggregateExec });
    const collectionFind = jest.fn().mockReturnValue({
      toArray: jest.fn().mockResolvedValue([]),
    });

    return {
      aggregate,
      db: {
        collection: jest.fn().mockReturnValue({
          find: collectionFind,
        }),
      },
    };
  }

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
      ({
        getEstimateBillingSummary: jest.fn().mockResolvedValue({
          invoice_status: null,
          latest_invoice_number: null,
          invoice_ready: true,
          send_ready: true,
          invoice_needs_refresh: false,
        }),
        getEstimateBillingSummariesForList: jest
          .fn()
          .mockResolvedValue(new Map()),
        getInvoiceHistoryCounts: jest.fn().mockResolvedValue({
          snapshotCount: 0,
          dispatchCount: 0,
        }),
        deleteInvoiceHistoryForEstimate: jest.fn().mockResolvedValue(undefined),
        markLatestSnapshotStaleIfNeeded: jest.fn().mockResolvedValue(undefined),
        ...(overrides?.estimateInvoiceService ?? {}),
      }) as never,
    );
  }

  it('always creates new estimates in scheduled status', async () => {
    const createEstimate = jest.fn().mockResolvedValue({
      _id: 'estimate-1',
      save: jest.fn().mockResolvedValue(undefined),
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
    const estimateModel = createListEstimateModel([
      {
        _id: 'estimate-1',
        estimate_number: 'EST-001',
        title: 'Brake Estimate',
        customer_id: '507f1f77bcf86cd799439011',
        vehicle_id: '507f1f77bcf86cd799439012',
        estimate_status: EstimateStatus.SCHEDULED,
        payment_status: PaidStatus.UNPAID,
        payment_type: 'POS_CARD',
        due_date: null,
        labor_total: 100,
        parts_total: 50,
        total: 150,
        services_count: 1,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
    ]);
    const getEstimateBillingSummariesForList = jest.fn().mockResolvedValue(
      new Map([
        [
          'estimate-1',
          {
            invoice_status: null,
            latest_invoice_number: null,
            invoice_ready: true,
            send_ready: true,
            invoice_needs_refresh: false,
          },
        ],
      ]),
    );

    const service = createService({
      estimateModel,
      estimateInvoiceService: { getEstimateBillingSummariesForList },
    });

    const result = await service.findAll({
      customer_id: '507f1f77bcf86cd799439011',
      vehicle_id: '507f1f77bcf86cd799439012',
    });

    const [pipeline] = estimateModel.aggregate.mock.calls[0] as [
      Array<{
        $match?: {
          customer_id?: { toString: () => string };
          vehicle_id?: { toString: () => string };
        };
      }>,
    ];
    const query = pipeline[0]?.$match;

    expect(query?.customer_id?.toString()).toBe('507f1f77bcf86cd799439011');
    expect(query?.vehicle_id?.toString()).toBe('507f1f77bcf86cd799439012');
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
    const estimateModel = createListEstimateModel([
      {
        _id: 'estimate-1',
        estimate_number: 'EST-001',
        title: 'Invoice Ready Estimate',
        customer_id: '507f1f77bcf86cd799439011',
        vehicle_id: '507f1f77bcf86cd799439012',
        estimate_status: EstimateStatus.SCHEDULED,
        payment_status: PaidStatus.UNPAID,
        payment_type: 'POS_CARD',
        due_date: null,
        labor_total: 0,
        parts_total: 0,
        total: 0,
        services_count: 1,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
    ]);
    const getEstimateBillingSummariesForList = jest.fn().mockResolvedValue(
      new Map([
        [
          'estimate-1',
          {
            invoice_status: EstimateInvoiceSnapshotStatus.ISSUED,
            latest_invoice_number: 'INV-777',
            invoice_ready: true,
            send_ready: true,
            invoice_needs_refresh: false,
          },
        ],
      ]),
    );

    const service = createService({
      estimateModel,
      estimateInvoiceService: {
        getEstimateBillingSummariesForList,
      },
    });

    await expect(service.findAll()).resolves.toMatchObject([
      {
        admin_invoice_workflow_state: 'ready_to_send',
        admin_invoice_workflow_title: 'Ready to Send',
        admin_invoice_workflow_detail: 'Last invoice: INV-777',
      },
    ]);
  });

  it('builds dashboard summary metrics on the backend', async () => {
    const estimateModel = createListEstimateModel([
      {
        _id: 'estimate-ready',
        estimate_number: 'EST-READY',
        title: 'Ready Estimate',
        customer_id: '507f1f77bcf86cd799439011',
        vehicle_id: '507f1f77bcf86cd799439012',
        payment_status: PaidStatus.UNPAID,
        payment_type: 'POS_CARD',
        estimate_status: EstimateStatus.SCHEDULED,
        due_date: null,
        labor_total: 100,
        parts_total: 0,
        total: 100,
        services_count: 1,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
      {
        _id: 'estimate-overdue',
        estimate_number: 'EST-OVERDUE',
        title: 'Overdue Estimate',
        customer_id: '507f1f77bcf86cd799439013',
        vehicle_id: '507f1f77bcf86cd799439014',
        payment_status: PaidStatus.UNPAID,
        payment_type: 'POS_CARD',
        estimate_status: EstimateStatus.COMPLETED,
        due_date: new Date(Date.now() - 60_000).toISOString(),
        labor_total: 0,
        parts_total: 50,
        total: 50,
        services_count: 1,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
    ]);
    const getEstimateBillingSummariesForList = jest.fn().mockResolvedValue(
      new Map([
        [
          'estimate-ready',
          {
            invoice_status: EstimateInvoiceSnapshotStatus.ISSUED,
            latest_invoice_number: 'INV-READY',
            invoice_ready: true,
            send_ready: true,
            invoice_needs_refresh: false,
          },
        ],
        [
          'estimate-overdue',
          {
            invoice_status: EstimateInvoiceSnapshotStatus.STALE,
            latest_invoice_number: 'INV-STALE',
            invoice_ready: true,
            send_ready: true,
            invoice_needs_refresh: true,
          },
        ],
      ]),
    );

    const service = createService({
      estimateModel,
      estimateInvoiceService: { getEstimateBillingSummariesForList },
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
      save: jest.fn().mockResolvedValue(undefined),
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

  it('requires payment_amount when setting PART_PAID', async () => {
    const estimate = {
      _id: '507f1f77bcf86cd799439011',
      payment_status: PaidStatus.UNPAID,
      amount_paid: 0,
      total: 200,
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
      service.updatePaymentStatus('507f1f77bcf86cd799439011', {
        payment_status: PaidStatus.PART_PAID,
      }),
    ).rejects.toThrow(BadRequestException);
  });

  it('stores PART_PAID payment_amount as paid-to-date amount', async () => {
    const save = jest.fn().mockResolvedValue(undefined);
    const estimate = {
      _id: '507f1f77bcf86cd799439011',
      payment_status: PaidStatus.UNPAID,
      amount_paid: 0,
      total: 200,
      toObject: jest.fn().mockImplementation(() => ({
        _id: '507f1f77bcf86cd799439011',
        estimate_number: 'EST-110',
        title: 'Payment Update',
        customer_id: '507f1f77bcf86cd799439012',
        vehicle_id: '507f1f77bcf86cd799439013',
        payment_status: estimate.payment_status,
        amount_paid: estimate.amount_paid,
        payment_type: 'POS_CARD',
        due_date: null,
        estimate_status: EstimateStatus.SCHEDULED,
        services: [],
        labor_total: 0,
        parts_total: 0,
        total: estimate.total,
      })),
      save,
    };

    const service = createService({
      estimateModel: {
        findById: jest.fn().mockReturnValue({
          exec: jest.fn().mockResolvedValue(estimate),
        }),
      },
    });

    await service.updatePaymentStatus('507f1f77bcf86cd799439011', {
      payment_status: PaidStatus.PART_PAID,
      payment_amount: 75,
    });

    expect(estimate.payment_status).toBe(PaidStatus.PART_PAID);
    expect(estimate.amount_paid).toBe(75);
  });

  it('updates PART_PAID paid-to-date when prior payment events already exist', async () => {
    const save = jest.fn().mockResolvedValue(undefined);
    const estimate = {
      _id: '507f1f77bcf86cd799439011',
      payment_status: PaidStatus.PART_PAID,
      amount_paid: 100,
      total: 500,
      payment_events: [
        {
          amount_delta: 100,
          amount_paid_total: 100,
          amount_remaining_total: 400,
          payment_status: PaidStatus.PART_PAID,
          recorded_at: new Date('2026-04-17T10:00:00.000Z'),
          source: 'STATUS_UPDATE',
          actor_user_id: null,
          note: 'Partial payment recorded',
        },
      ],
      toObject: jest.fn().mockImplementation(() => ({
        _id: '507f1f77bcf86cd799439011',
        estimate_number: 'EST-111',
        title: 'Payment Update Existing Ledger',
        customer_id: '507f1f77bcf86cd799439012',
        vehicle_id: '507f1f77bcf86cd799439013',
        payment_status: estimate.payment_status,
        amount_paid: estimate.amount_paid,
        payment_events: estimate.payment_events,
        payment_type: 'POS_CARD',
        due_date: null,
        estimate_status: EstimateStatus.SCHEDULED,
        services: [],
        labor_total: 0,
        parts_total: 0,
        total: estimate.total,
      })),
      save,
    };

    const service = createService({
      estimateModel: {
        findById: jest.fn().mockReturnValue({
          exec: jest.fn().mockResolvedValue(estimate),
        }),
      },
    });

    await service.updatePaymentStatus('507f1f77bcf86cd799439011', {
      payment_status: PaidStatus.PART_PAID,
      payment_amount: 400,
    });

    expect(estimate.payment_status).toBe(PaidStatus.PART_PAID);
    expect(estimate.amount_paid).toBe(400);
    expect(estimate.payment_events).toHaveLength(2);
    expect(estimate.payment_events[1].amount_delta).toBe(300);
    expect(estimate.payment_events[1].amount_paid_total).toBe(400);
    expect(estimate.payment_events[1].amount_remaining_total).toBe(100);
  });

  it('preserves legacy PART_PAID status when amount_paid is missing during estimate updates', async () => {
    const save = jest.fn().mockResolvedValue(undefined);
    const applyEstimateUpdate = jest.fn().mockResolvedValue(undefined);
    const estimate = {
      _id: '507f1f77bcf86cd799439011',
      estimate_number: 'EST-102',
      title: 'Legacy Partial Payment',
      customer_id: '507f1f77bcf86cd799439012',
      vehicle_id: '507f1f77bcf86cd799439013',
      assigned_user_id: null,
      complaint_or_request: null,
      notes: null,
      payment_type: 'POS_CARD',
      due_date: null,
      estimate_status: EstimateStatus.SCHEDULED,
      payment_status: PaidStatus.PART_PAID,
      amount_paid: undefined,
      services: [],
      labor_total: 0,
      parts_total: 0,
      total: 200,
      toObject: jest.fn().mockImplementation(() => ({
        _id: '507f1f77bcf86cd799439011',
        estimate_number: 'EST-102',
        title: 'Legacy Partial Payment',
        customer_id: '507f1f77bcf86cd799439012',
        vehicle_id: '507f1f77bcf86cd799439013',
        assigned_user_id: null,
        complaint_or_request: null,
        notes: null,
        payment_type: 'POS_CARD',
        due_date: null,
        estimate_status: EstimateStatus.SCHEDULED,
        payment_status: estimate.payment_status,
        amount_paid: estimate.amount_paid,
        services: [],
        labor_total: 0,
        parts_total: 0,
        total: 200,
        created_at: new Date('2026-04-03T08:00:00.000Z'),
        updated_at: new Date('2026-04-03T08:30:00.000Z'),
      })),
      save,
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
      title: 'Legacy Partial Payment Updated',
    });

    expect(estimate.payment_status).toBe(PaidStatus.PART_PAID);
    expect(estimate.amount_paid).toBe(0);
  });
});
