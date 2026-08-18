import { BadRequestException } from '@nestjs/common';
import { Types } from 'mongoose';
import { DashboardService } from './dashboard.service';

function execResult<T>(value: T) {
  return {
    exec: jest.fn().mockResolvedValue(value),
  };
}

function buildFindMock(results: unknown[][]) {
  return jest.fn().mockImplementation(() => ({
    sort: jest.fn().mockReturnValue({
      limit: jest.fn().mockReturnValue({
        lean: jest.fn().mockReturnValue(execResult(results.shift() ?? [])),
      }),
    }),
  }));
}

describe('DashboardService', () => {
  const organizationId = new Types.ObjectId().toString();

  function buildService({
    documentAggregates = [],
    ledgerAggregates = [],
    documentFinds = [],
  }: {
    documentAggregates?: unknown[][];
    ledgerAggregates?: unknown[][];
    documentFinds?: unknown[][];
  }) {
    const documentPipelines: unknown[][] = [];
    const documentModel = {
      countDocuments: jest
        .fn()
        .mockResolvedValueOnce(3)
        .mockResolvedValueOnce(2),
      aggregate: jest.fn().mockImplementation((pipeline: unknown[]) => {
        documentPipelines.push(pipeline);
        return execResult(documentAggregates.shift() ?? []);
      }),
      find: buildFindMock(documentFinds),
      distinct: jest.fn().mockReturnValue(execResult([])),
    };
    const ledgerPipelines: unknown[][] = [];
    const ledgerModel = {
      aggregate: jest.fn().mockImplementation((pipeline: unknown[]) => {
        ledgerPipelines.push(pipeline);
        return execResult(ledgerAggregates.shift() ?? []);
      }),
    };

    const service = new DashboardService(
      documentModel as never,
      ledgerModel as never,
      {
        getAppSettings: jest.fn().mockResolvedValue({
          business_timezone: 'America/New_York',
        }),
      } as never,
    );
    return {
      service,
      documentModel,
      ledgerModel,
      documentPipelines,
      ledgerPipelines,
    };
  }

  it('builds the operational dashboard from scoped backend aggregates', async () => {
    const estimateId = new Types.ObjectId();
    const invoiceId = new Types.ObjectId();
    const lineId = new Types.ObjectId();
    const clientId = new Types.ObjectId();

    const baseEstimate = {
      _id: estimateId,
      type: 'estimate',
      number: 'EST-001',
      status: 'pending',
      client_id: clientId,
      client_snapshot: { display_name: 'Pat Client' },
      job_name: 'Kitchen Remodel',
      issue_date: new Date('2026-08-01T12:00:00.000Z'),
      expiration_date: new Date('2026-08-31T12:00:00.000Z'),
      due_date: null,
      total_minor: 14698,
      balance_due_minor: 0,
    };
    const baseInvoice = {
      _id: invoiceId,
      type: 'invoice',
      number: 'INV-001',
      status: 'sent',
      client_id: clientId,
      client_snapshot: { display_name: 'Pat Client' },
      job_name: 'Kitchen Remodel',
      issue_date: new Date('2026-08-01T12:00:00.000Z'),
      due_date: new Date('2026-08-05T12:00:00.000Z'),
      expiration_date: null,
      total_minor: 250000,
      amount_paid_minor: 0,
      amount_refunded_minor: 0,
      amount_disputed_minor: 0,
      balance_due_minor: 250000,
    };

    const { service } = buildService({
      documentAggregates: [
        [{ count: 1, balance_minor: 250000 }],
        [{ count: 1, balance_minor: 250000 }],
        [
          {
            id: lineId.toString(),
            document_id: estimateId.toString(),
            document_type: 'estimate',
            document_number: 'EST-001',
            document_status: 'pending',
            client_name: 'Pat Client',
            job_name: 'Kitchen Remodel',
            service_address_summary: '12 Job St, Atlanta, GA',
            description: 'Pressure-treated lumber',
            quantity_milli: 12000,
            unit_of_measure: 'board',
            vendor_name: 'Home Depot',
            sku_or_part_number: 'PT-12',
            purchase_status: 'needed',
            internal_unit_cost_minor: 900,
            internal_cost_total_minor: 10800,
            customer_total_minor: 14698,
            href: `/dashboard/estimates/${estimateId.toString()}`,
            sort_date: new Date(),
          },
        ],
        [{ total_count: 1 }],
        [
          {
            invoiced_total_minor: 250000,
            tax_total_minor: 0,
          },
        ],
        [{ count: 1, balance_minor: 250000 }],
        [{ count: 1, balance_minor: 250000 }],
        [{ denominator: 2, numerator: 1 }],
        [],
        [
          {
            id: lineId.toString(),
            document_id: estimateId.toString(),
            document_type: 'estimate',
            document_number: 'EST-001',
            document_status: 'pending',
            client_name: 'Pat Client',
            job_name: 'Kitchen Remodel',
            service_address_summary: '12 Job St, Atlanta, GA',
            description: 'Pressure-treated lumber',
            quantity_milli: 12000,
            unit_of_measure: 'board',
            vendor_name: 'Home Depot',
            sku_or_part_number: 'PT-12',
            purchase_status: 'needed',
            internal_unit_cost_minor: 900,
            internal_cost_total_minor: 10800,
            customer_total_minor: 14698,
            href: `/dashboard/estimates/${estimateId.toString()}`,
            sort_date: new Date(),
          },
        ],
        [{ total_count: 1 }],
      ],
      ledgerAggregates: [
        [{ collected_total_minor: 100000, deposits_collected_minor: 25000 }],
        [{ month: '2026-08', collected_minor: 100000 }],
      ],
      documentFinds: [[baseInvoice], [], [], [baseEstimate], [baseInvoice]],
    });

    const result = await service.getDashboardSummary(organizationId);

    expect(result.metrics.pending_estimates_count).toBe(3);
    expect(result.metrics.approved_estimates_count).toBe(2);
    expect(result.metrics.unpaid_invoices_count).toBe(1);
    expect(result.metrics.overdue_invoices_count).toBe(1);
    expect(result.metrics.materials_to_buy_count).toBe(1);
    expect(result.metrics.outstanding_balance_minor).toBe(250000);
    expect(result.needs_action).toHaveLength(2);
    expect(result.needs_action[0]).toMatchObject({
      number: 'INV-001',
      href: `/dashboard/invoices/${invoiceId.toString()}`,
      reason: 'Overdue invoice',
    });
    expect(result.materials_to_buy[0]).toMatchObject({
      description: 'Pressure-treated lumber',
      purchase_status: 'needed',
    });
  });

  it('excludes converted estimates from ready-to-invoice work', async () => {
    const convertedEstimateId = new Types.ObjectId();
    const { service, documentModel } = buildService({
      documentAggregates: [[], [], [], []],
      documentFinds: [[], [], [], []],
    });
    documentModel.distinct.mockReturnValue(execResult([convertedEstimateId]));

    await service.getDashboardSummary(organizationId);

    expect(documentModel.find).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'estimate',
        status: 'approved',
        _id: { $nin: [convertedEstimateId] },
      }),
    );
  });

  it('rejects inverted report date ranges', async () => {
    const { service } = buildService({});

    await expect(
      service.getReportsSummary(organizationId, {
        date_from: '2026-08-11T00:00:00.000Z',
        date_to: '2026-08-01T00:00:00.000Z',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects an adjacent inverted calendar range', async () => {
    const { service } = buildService({});

    await expect(
      service.getReportsSummary(organizationId, {
        date_from: '2026-08-12',
        date_to: '2026-08-11',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('uses document calendar dates and business-local payment boundaries for the same report range', async () => {
    const { service, documentPipelines, ledgerPipelines } = buildService({});

    await service.getReportsSummary(organizationId, {
      date_from: '2026-08-01',
      date_to: '2026-08-11',
    });

    type MatchStage = { $match: Record<string, unknown> };
    const invoiceMatch = (documentPipelines[0] as MatchStage[])[0].$match;
    const ledgerMatch = (ledgerPipelines[0] as MatchStage[])[0].$match;

    expect(invoiceMatch.issue_date).toEqual({
      $gte: new Date('2026-08-01T00:00:00.000Z'),
      $lt: new Date('2026-08-12T00:00:00.000Z'),
    });
    expect(ledgerMatch.effective_at).toEqual({
      $gte: new Date('2026-08-01T04:00:00.000Z'),
      $lt: new Date('2026-08-12T04:00:00.000Z'),
    });
  });

  it('keeps issued invoice history and decided estimates in report formulas', async () => {
    const { service, documentPipelines } = buildService({
      documentAggregates: [[], [], [], [], [], [], [], []],
      ledgerAggregates: [[], []],
      documentFinds: [[]],
    });

    await service.getReportsSummary(organizationId, {});

    type MatchStage = { $match: Record<string, unknown> };
    const invoiceTotalsPipeline = documentPipelines[0] as MatchStage[];
    const conversionPipeline = documentPipelines[3] as MatchStage[];
    const topClientsPipeline = documentPipelines[4] as MatchStage[];
    const topClientsGroup = topClientsPipeline[1] as unknown as {
      $group: Record<string, unknown>;
    };

    expect(invoiceTotalsPipeline[0].$match).toEqual(
      expect.objectContaining({
        type: 'invoice',
        $or: [
          { status: { $in: ['issued', 'sent'] } },
          {
            status: 'archived',
            archived_from_status: { $in: ['issued', 'sent'] },
          },
        ],
      }),
    );
    expect(topClientsPipeline[0].$match['$or']).toEqual(
      invoiceTotalsPipeline[0].$match['$or'],
    );
    expect(topClientsGroup.$group.balance_due_minor).toEqual({
      $sum: {
        $cond: [
          { $in: ['$status', ['issued', 'sent']] },
          '$balance_due_minor',
          0,
        ],
      },
    });
    expect(conversionPipeline[0].$match['$or']).toEqual([
      { status: { $in: ['approved', 'declined'] } },
      {
        status: 'archived',
        archived_from_status: { $in: ['approved', 'declined'] },
      },
    ]);
  });
});
