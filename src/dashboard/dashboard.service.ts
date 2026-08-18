import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Address } from '../common/schemas/address.schema';
import { asObjectId } from '../common/utils/object-id';
import {
  calendarDateBoundsInTimeZone,
  parseCalendarDateUtc,
  startOfBusinessCalendarDateUtc,
} from '../common/utils/business-time';
import {
  OrgDocument,
  OrgDocumentDocument,
  PurchaseStatus,
} from '../documents/schemas/document.schema';
import { computeInvoicePaymentDisplay } from '../invoices/invoice-payment-state';
import {
  PaymentLedgerEntry,
  PaymentLedgerEntryDocument,
} from '../invoices/schemas/payment-ledger-entry.schema';
import { SettingsService } from '../settings/settings.service';

type ReportDateRange = {
  date_from?: string;
  date_to?: string;
};

type ReportBounds = {
  dateFrom: Date | null;
  dateTo: Date | null;
  dateToExclusive: boolean;
};

type DashboardDocument = {
  id: string;
  type: 'estimate' | 'invoice';
  number: string;
  status: string;
  client_name: string;
  job_name: string | null;
  service_address_summary: string | null;
  issue_date: string | null;
  due_date: string | null;
  expiration_date: string | null;
  total_minor: number;
  balance_due_minor: number;
  href: string;
  reason: string | null;
};

type MaterialLine = {
  id: string;
  document_id: string;
  document_type: 'estimate' | 'invoice';
  document_number: string;
  document_status: string;
  client_name: string;
  job_name: string | null;
  service_address_summary: string | null;
  description: string;
  quantity_milli: number;
  unit_of_measure: string | null;
  vendor_name: string | null;
  sku_or_part_number: string | null;
  purchase_status: PurchaseStatus;
  internal_unit_cost_minor: number | null;
  internal_cost_total_minor: number;
  customer_total_minor: number;
  href: string;
};

const ACTIVE_INVOICE_STATUSES = ['issued', 'sent'];
const DECIDED_ESTIMATE_STATUSES = ['approved', 'declined'];
const MATERIAL_PURCHASE_STATUSES = ['needed', 'quoted', 'ordered'];

@Injectable()
export class DashboardService {
  constructor(
    @InjectModel(OrgDocument.name)
    private readonly documentModel: Model<OrgDocumentDocument>,
    @InjectModel(PaymentLedgerEntry.name)
    private readonly ledgerModel: Model<PaymentLedgerEntryDocument>,
    private readonly settingsService: SettingsService,
  ) {}

  async getDashboardSummary(organizationId: string) {
    const orgId = asObjectId(organizationId, 'organization id');
    const timeZone = await this.getBusinessTimeZone(organizationId);
    const todayStart = startOfBusinessCalendarDateUtc(new Date(), timeZone);
    const convertedEstimateIds = await this.convertedEstimateIds(orgId);

    const [
      pendingEstimatesCount,
      approvedEstimatesCount,
      unpaidInvoices,
      overdueInvoices,
      materialsToBuy,
      needsAction,
    ] = await Promise.all([
      this.documentModel.countDocuments({
        organization_id: orgId,
        type: 'estimate',
        status: 'pending',
      }),
      this.documentModel.countDocuments({
        organization_id: orgId,
        type: 'estimate',
        status: 'approved',
      }),
      this.invoiceBalanceAggregate(orgId),
      this.invoiceBalanceAggregate(orgId, { overdueBefore: todayStart }),
      this.materialLinesToBuy(orgId, 8, convertedEstimateIds),
      this.needsAction(orgId, todayStart, convertedEstimateIds),
    ]);
    return {
      generated_at: new Date().toISOString(),
      metrics: {
        pending_estimates_count: pendingEstimatesCount,
        approved_estimates_count: approvedEstimatesCount,
        unpaid_invoices_count: unpaidInvoices.count,
        overdue_invoices_count: overdueInvoices.count,
        outstanding_balance_minor: unpaidInvoices.balance_minor,
        overdue_balance_minor: overdueInvoices.balance_minor,
        materials_to_buy_count: materialsToBuy.total_count,
      },
      needs_action: needsAction,
      materials_to_buy: materialsToBuy.items,
    };
  }

  async getReportsSummary(organizationId: string, range: ReportDateRange) {
    const orgId = asObjectId(organizationId, 'organization id');
    const timeZone = await this.getBusinessTimeZone(organizationId);
    const documentBounds = this.parseDocumentDateRange(range);
    const eventBounds = this.parseEventDateRange(range, timeZone);
    const todayStart = startOfBusinessCalendarDateUtc(new Date(), timeZone);

    const [
      invoiceTotals,
      outstandingInvoices,
      overdueInvoiceTotals,
      ledgerTotals,
      conversion,
      topClients,
      materialsToBuy,
      revenueByMonth,
      overdueInvoices,
    ] = await Promise.all([
      this.invoiceTotals(orgId, documentBounds),
      this.invoiceBalanceAggregate(orgId),
      this.invoiceBalanceAggregate(orgId, { overdueBefore: todayStart }),
      this.ledgerTotals(orgId, eventBounds),
      this.estimateConversion(orgId, documentBounds),
      this.topClients(orgId, documentBounds),
      this.materialLinesToBuy(orgId, 50),
      this.revenueByMonth(orgId, eventBounds, timeZone),
      this.unpaidInvoiceRows(orgId, todayStart, 10),
    ]);

    return {
      generated_at: new Date().toISOString(),
      date_range: {
        date_from: range.date_from ?? null,
        date_to: range.date_to ?? null,
      },
      metrics: {
        invoiced_total_minor: invoiceTotals.invoiced_total_minor,
        tax_total_minor: invoiceTotals.tax_total_minor,
        outstanding_balance_minor: outstandingInvoices.balance_minor,
        overdue_balance_minor: overdueInvoiceTotals.balance_minor,
        collected_total_minor: ledgerTotals.collected_total_minor,
        deposits_collected_minor: ledgerTotals.deposits_collected_minor,
        estimate_conversion_rate_basis_points:
          conversion.conversion_rate_basis_points,
        estimate_conversion_numerator: conversion.numerator,
        estimate_conversion_denominator: conversion.denominator,
        materials_to_buy_count: materialsToBuy.total_count,
      },
      revenue_by_month: revenueByMonth,
      overdue_invoices: overdueInvoices,
      top_clients: topClients,
      materials_to_buy: materialsToBuy.items,
      formula_notes: [
        'Collected revenue uses payment ledger receipts and adjustments minus refunds and dispute holds by effective date.',
        'Invoice and estimate periods use their stored calendar dates; payment periods use the configured business timezone.',
        'Outstanding and overdue are current positive balances and do not change with the report date range.',
        'Estimate win rate is approved estimates divided by approved plus declined estimates for the selected period.',
        'Archived invoices that were previously issued or sent remain in historical invoiced totals.',
        'Materials to buy includes approved-estimate and issued/sent-invoice material or equipment lines marked needed, quoted, or ordered.',
      ],
    };
  }

  private parseEventDateRange(range: ReportDateRange, timeZone: string) {
    const fromCalendar = range.date_from
      ? calendarDateBoundsInTimeZone(range.date_from, timeZone)
      : null;
    const toCalendar = range.date_to
      ? calendarDateBoundsInTimeZone(range.date_to, timeZone)
      : null;
    const dateFrom = range.date_from
      ? (fromCalendar?.start ?? new Date(range.date_from))
      : null;
    const dateTo = range.date_to
      ? (toCalendar?.endExclusive ?? new Date(range.date_to))
      : null;
    const dateToExclusive = Boolean(toCalendar);
    if (dateFrom && Number.isNaN(dateFrom.getTime())) {
      throw new BadRequestException('Invalid date_from');
    }
    if (dateTo && Number.isNaN(dateTo.getTime())) {
      throw new BadRequestException('Invalid date_to');
    }
    if (dateFrom && dateTo && dateFrom.getTime() >= dateTo.getTime()) {
      throw new BadRequestException('date_from must be before date_to');
    }
    return { dateFrom, dateTo, dateToExclusive };
  }

  private parseDocumentDateRange(range: ReportDateRange): ReportBounds {
    const parse = (value: string | undefined, end: boolean) => {
      if (!value) return null;
      const match = /^(\d{4}-\d{2}-\d{2})$/.exec(value);
      const date = match ? parseCalendarDateUtc(match[1]) : new Date(value);
      if (!date || Number.isNaN(date.getTime())) {
        throw new BadRequestException('Invalid report date');
      }
      if (match && end) date.setUTCDate(date.getUTCDate() + 1);
      return date;
    };
    const dateFrom = parse(range.date_from, false);
    const dateTo = parse(range.date_to, true);
    if (dateFrom && dateTo && dateFrom.getTime() >= dateTo.getTime()) {
      throw new BadRequestException('date_from must be before date_to');
    }
    return { dateFrom, dateTo, dateToExclusive: Boolean(range.date_to) };
  }

  private periodMatch(field: string, bounds: ReportBounds) {
    const match: Record<string, Date> = {};
    if (bounds.dateFrom) {
      match.$gte = bounds.dateFrom;
    }
    if (bounds.dateTo) {
      match[bounds.dateToExclusive ? '$lt' : '$lte'] = bounds.dateTo;
    }
    return Object.keys(match).length > 0 ? { [field]: match } : {};
  }

  private async invoiceBalanceAggregate(
    orgId: Types.ObjectId,
    options: { overdueBefore?: Date } = {},
  ) {
    const [result] = await this.documentModel
      .aggregate<{ count: number; balance_minor: number }>([
        {
          $match: {
            organization_id: orgId,
            type: 'invoice',
            status: { $in: ACTIVE_INVOICE_STATUSES },
            balance_due_minor: { $gt: 0 },
            ...(options.overdueBefore
              ? { due_date: { $ne: null, $lt: options.overdueBefore } }
              : {}),
          },
        },
        {
          $group: {
            _id: null,
            count: { $sum: 1 },
            balance_minor: { $sum: '$balance_due_minor' },
          },
        },
      ])
      .exec();
    return {
      count: result?.count ?? 0,
      balance_minor: result?.balance_minor ?? 0,
    };
  }

  private async invoiceTotals(orgId: Types.ObjectId, bounds: ReportBounds) {
    const [result] = await this.documentModel
      .aggregate<{
        invoiced_total_minor: number;
        tax_total_minor: number;
      }>([
        {
          $match: {
            organization_id: orgId,
            type: 'invoice',
            ...this.issuedInvoiceHistoryMatch(),
            ...this.periodMatch('issue_date', bounds),
          },
        },
        {
          $group: {
            _id: null,
            invoiced_total_minor: { $sum: '$total_minor' },
            tax_total_minor: { $sum: '$tax_total_minor' },
          },
        },
      ])
      .exec();

    return {
      invoiced_total_minor: result?.invoiced_total_minor ?? 0,
      tax_total_minor: result?.tax_total_minor ?? 0,
    };
  }

  private async ledgerTotals(orgId: Types.ObjectId, bounds: ReportBounds) {
    const [result] = await this.ledgerModel
      .aggregate<{
        collected_total_minor: number;
        deposits_collected_minor: number;
      }>([
        {
          $match: {
            organization_id: orgId,
            ...this.periodMatch('effective_at', bounds),
          },
        },
        {
          $lookup: {
            from: 'payments',
            localField: 'payment_id',
            foreignField: '_id',
            as: 'payment',
          },
        },
        { $unwind: '$payment' },
        {
          $addFields: {
            signed_amount_minor: {
              $switch: {
                branches: [
                  {
                    case: { $eq: ['$entry_type', 'payment'] },
                    then: '$amount_minor',
                  },
                  {
                    case: { $eq: ['$entry_type', 'refund'] },
                    then: { $multiply: [{ $abs: '$amount_minor' }, -1] },
                  },
                  {
                    case: { $eq: ['$entry_type', 'dispute_hold'] },
                    then: { $multiply: [{ $abs: '$amount_minor' }, -1] },
                  },
                  {
                    case: { $eq: ['$entry_type', 'dispute_reversal'] },
                    then: { $abs: '$amount_minor' },
                  },
                  {
                    case: { $eq: ['$entry_type', 'manual_adjustment'] },
                    then: '$amount_minor',
                  },
                ],
                default: 0,
              },
            },
          },
        },
        {
          $group: {
            _id: null,
            collected_total_minor: { $sum: '$signed_amount_minor' },
            deposits_collected_minor: {
              $sum: {
                $cond: [
                  { $eq: ['$payment.purpose', 'deposit'] },
                  '$signed_amount_minor',
                  0,
                ],
              },
            },
          },
        },
      ])
      .exec();

    return {
      collected_total_minor: result?.collected_total_minor ?? 0,
      deposits_collected_minor: result?.deposits_collected_minor ?? 0,
    };
  }

  private async estimateConversion(
    orgId: Types.ObjectId,
    bounds: ReportBounds,
  ) {
    const [result] = await this.documentModel
      .aggregate<{ denominator: number; numerator: number }>([
        {
          $match: {
            organization_id: orgId,
            type: 'estimate',
            $or: [
              { status: { $in: DECIDED_ESTIMATE_STATUSES } },
              {
                status: 'archived',
                archived_from_status: { $in: DECIDED_ESTIMATE_STATUSES },
              },
            ],
            ...this.periodMatch('issue_date', bounds),
          },
        },
        {
          $group: {
            _id: null,
            denominator: { $sum: 1 },
            numerator: {
              $sum: {
                $cond: [
                  {
                    $or: [
                      { $eq: ['$status', 'approved'] },
                      {
                        $and: [
                          { $eq: ['$status', 'archived'] },
                          { $eq: ['$archived_from_status', 'approved'] },
                        ],
                      },
                    ],
                  },
                  1,
                  0,
                ],
              },
            },
          },
        },
      ])
      .exec();
    const denominator = result?.denominator ?? 0;
    const numerator = result?.numerator ?? 0;
    return {
      denominator,
      numerator,
      conversion_rate_basis_points:
        denominator > 0 ? Math.round((numerator / denominator) * 10000) : 0,
    };
  }

  private async topClients(orgId: Types.ObjectId, bounds: ReportBounds) {
    return this.documentModel
      .aggregate([
        {
          $match: {
            organization_id: orgId,
            type: 'invoice',
            ...this.issuedInvoiceHistoryMatch(),
            ...this.periodMatch('issue_date', bounds),
          },
        },
        {
          $group: {
            _id: '$client_id',
            client_name: { $first: '$client_snapshot.display_name' },
            invoice_count: { $sum: 1 },
            total_minor: { $sum: '$total_minor' },
            balance_due_minor: {
              $sum: {
                $cond: [
                  { $in: ['$status', ACTIVE_INVOICE_STATUSES] },
                  '$balance_due_minor',
                  0,
                ],
              },
            },
          },
        },
        { $sort: { total_minor: -1, _id: 1 } },
        { $limit: 5 },
        {
          $project: {
            _id: 0,
            client_id: { $toString: '$_id' },
            client_name: { $ifNull: ['$client_name', 'Client'] },
            invoice_count: 1,
            total_minor: 1,
            balance_due_minor: 1,
          },
        },
      ])
      .exec();
  }

  private issuedInvoiceHistoryMatch() {
    return {
      $or: [
        { status: { $in: ACTIVE_INVOICE_STATUSES } },
        {
          status: 'archived',
          archived_from_status: { $in: ACTIVE_INVOICE_STATUSES },
        },
      ],
    };
  }

  private async revenueByMonth(
    orgId: Types.ObjectId,
    bounds: ReportBounds,
    timeZone: string,
  ) {
    return this.ledgerModel
      .aggregate([
        {
          $match: {
            organization_id: orgId,
            ...this.periodMatch('effective_at', bounds),
          },
        },
        {
          $addFields: {
            signed_amount_minor: {
              $switch: {
                branches: [
                  {
                    case: { $eq: ['$entry_type', 'payment'] },
                    then: '$amount_minor',
                  },
                  {
                    case: { $eq: ['$entry_type', 'manual_adjustment'] },
                    then: '$amount_minor',
                  },
                  {
                    case: { $eq: ['$entry_type', 'refund'] },
                    then: { $multiply: [{ $abs: '$amount_minor' }, -1] },
                  },
                  {
                    case: { $eq: ['$entry_type', 'dispute_hold'] },
                    then: { $multiply: [{ $abs: '$amount_minor' }, -1] },
                  },
                  {
                    case: { $eq: ['$entry_type', 'dispute_reversal'] },
                    then: { $abs: '$amount_minor' },
                  },
                ],
                default: 0,
              },
            },
          },
        },
        {
          $group: {
            _id: {
              $dateToString: {
                format: '%Y-%m',
                date: '$effective_at',
                timezone: timeZone,
              },
            },
            collected_minor: { $sum: '$signed_amount_minor' },
          },
        },
        { $sort: { _id: 1 } },
        { $project: { _id: 0, month: '$_id', collected_minor: 1 } },
      ])
      .exec();
  }

  private async unpaidInvoiceRows(
    orgId: Types.ObjectId,
    overdueBefore: Date | null,
    limit: number,
  ): Promise<DashboardDocument[]> {
    const docs = await this.documentModel
      .find({
        organization_id: orgId,
        type: 'invoice',
        status: { $in: ACTIVE_INVOICE_STATUSES },
        balance_due_minor: { $gt: 0 },
        ...(overdueBefore
          ? { due_date: { $ne: null, $lt: overdueBefore } }
          : {}),
      })
      .sort({ due_date: 1, updated_at: -1, _id: -1 })
      .limit(limit)
      .lean()
      .exec();
    return docs.map((doc) =>
      this.serializeDocument(
        doc,
        overdueBefore ? 'Overdue invoice' : 'Open balance',
      ),
    );
  }

  private async needsAction(
    orgId: Types.ObjectId,
    todayStart: Date,
    convertedEstimateIds: Types.ObjectId[],
  ): Promise<DashboardDocument[]> {
    const baseInvoiceMatch = {
      organization_id: orgId,
      type: 'invoice' as const,
      status: { $in: ACTIVE_INVOICE_STATUSES },
      balance_due_minor: { $gt: 0 },
    };
    const [overdueInvoices, approvedEstimates, openInvoices, pendingEstimates] =
      await Promise.all([
        this.documentModel
          .find({
            ...baseInvoiceMatch,
            due_date: { $ne: null, $lt: todayStart },
          })
          .sort({ due_date: 1, _id: 1 })
          .limit(8)
          .lean()
          .exec(),
        this.documentModel
          .find({
            organization_id: orgId,
            type: 'estimate',
            status: 'approved',
            _id: { $nin: convertedEstimateIds },
          })
          .sort({ updated_at: 1, _id: 1 })
          .limit(8)
          .lean()
          .exec(),
        this.documentModel
          .find({
            ...baseInvoiceMatch,
            $or: [{ due_date: null }, { due_date: { $gte: todayStart } }],
          })
          .sort({ due_date: 1, updated_at: 1, _id: 1 })
          .limit(8)
          .lean()
          .exec(),
        this.documentModel
          .find({
            organization_id: orgId,
            type: 'estimate',
            status: 'pending',
          })
          .sort({ expiration_date: 1, updated_at: 1, _id: 1 })
          .limit(8)
          .lean()
          .exec(),
      ]);

    const docs = [
      ...overdueInvoices,
      ...approvedEstimates,
      ...openInvoices,
      ...pendingEstimates,
    ];

    return docs
      .map((doc) => ({ doc, priority: this.actionPriority(doc, todayStart) }))
      .sort((left, right) => {
        if (left.priority.rank !== right.priority.rank) {
          return left.priority.rank - right.priority.rank;
        }
        if (left.priority.date !== right.priority.date) {
          return left.priority.date - right.priority.date;
        }
        return left.doc._id.toString().localeCompare(right.doc._id.toString());
      })
      .slice(0, 8)
      .map(({ doc }) => {
        if (doc.type === 'invoice') {
          const overdue =
            doc.due_date != null &&
            new Date(doc.due_date).getTime() < todayStart.getTime();
          return this.serializeDocument(
            doc,
            overdue ? 'Overdue invoice' : 'Collect payment',
          );
        }
        return this.serializeDocument(
          doc,
          doc.status === 'approved' ? 'Ready to invoice' : 'Waiting on client',
        );
      });
  }

  private actionPriority(doc: OrgDocumentDocument, todayStart: Date) {
    const dueAt = doc.due_date ? new Date(doc.due_date).getTime() : Infinity;
    const expiresAt = doc.expiration_date
      ? new Date(doc.expiration_date).getTime()
      : Infinity;
    const updatedAt = doc.updated_at
      ? new Date(doc.updated_at).getTime()
      : Infinity;
    if (doc.type === 'invoice' && dueAt < todayStart.getTime()) {
      return { rank: 0, date: dueAt };
    }
    if (doc.type === 'estimate' && doc.status === 'approved') {
      return { rank: 1, date: updatedAt };
    }
    if (doc.type === 'invoice') {
      return { rank: 2, date: dueAt };
    }
    return { rank: 3, date: expiresAt };
  }

  private async materialLinesToBuy(
    orgId: Types.ObjectId,
    limit: number,
    knownConvertedEstimateIds?: Types.ObjectId[],
  ) {
    const convertedEstimateIds =
      knownConvertedEstimateIds ?? (await this.convertedEstimateIds(orgId));
    const rows = await this.documentModel
      .aggregate<MaterialLine & { sort_date: Date }>([
        {
          $match: {
            organization_id: orgId,
            $or: [
              {
                type: 'invoice',
                status: { $in: ACTIVE_INVOICE_STATUSES },
              },
              {
                type: 'estimate',
                status: 'approved',
                _id: { $nin: convertedEstimateIds },
              },
            ],
          },
        },
        { $unwind: '$line_items' },
        {
          $match: {
            'line_items.line_type': { $in: ['material', 'equipment'] },
            'line_items.purchase_status': { $in: MATERIAL_PURCHASE_STATUSES },
          },
        },
        { $sort: { updated_at: -1, _id: -1 } },
        { $limit: limit },
        {
          $project: {
            _id: 0,
            id: { $toString: '$line_items._id' },
            document_id: { $toString: '$_id' },
            document_type: '$type',
            document_number: '$number',
            document_status: '$status',
            client_name: {
              $ifNull: ['$client_snapshot.display_name', 'Client'],
            },
            job_name: { $ifNull: ['$job_name', null] },
            service_address_summary: {
              $let: {
                vars: {
                  address: {
                    $ifNull: [
                      '$service_address_snapshot',
                      '$client_snapshot.service_address',
                    ],
                  },
                },
                in: {
                  $trim: {
                    input: {
                      $reduce: {
                        input: [
                          '$$address.street',
                          '$$address.suite',
                          '$$address.city',
                          '$$address.state',
                          '$$address.postal_code',
                        ],
                        initialValue: '',
                        in: {
                          $cond: [
                            {
                              $or: [
                                { $eq: ['$$this', null] },
                                { $eq: ['$$this', ''] },
                              ],
                            },
                            '$$value',
                            {
                              $concat: [
                                '$$value',
                                {
                                  $cond: [{ $eq: ['$$value', ''] }, '', ', '],
                                },
                                '$$this',
                              ],
                            },
                          ],
                        },
                      },
                    },
                  },
                },
              },
            },
            description: '$line_items.description',
            quantity_milli: '$line_items.quantity_milli',
            unit_of_measure: { $ifNull: ['$line_items.unit_of_measure', null] },
            vendor_name: { $ifNull: ['$line_items.vendor_name', null] },
            sku_or_part_number: {
              $ifNull: ['$line_items.sku_or_part_number', null],
            },
            purchase_status: '$line_items.purchase_status',
            internal_unit_cost_minor: {
              $ifNull: ['$line_items.internal_unit_cost_minor', null],
            },
            internal_cost_total_minor: '$line_items.internal_cost_total_minor',
            customer_total_minor: '$line_items.total_minor',
            href: {
              $concat: ['/dashboard/', '$type', 's/', { $toString: '$_id' }],
            },
            sort_date: '$updated_at',
          },
        },
      ])
      .exec();

    const [countResult] = await this.documentModel
      .aggregate<{ total_count: number }>([
        {
          $match: {
            organization_id: orgId,
            $or: [
              { type: 'invoice', status: { $in: ACTIVE_INVOICE_STATUSES } },
              {
                type: 'estimate',
                status: 'approved',
                _id: { $nin: convertedEstimateIds },
              },
            ],
          },
        },
        { $unwind: '$line_items' },
        {
          $match: {
            'line_items.line_type': { $in: ['material', 'equipment'] },
            'line_items.purchase_status': { $in: MATERIAL_PURCHASE_STATUSES },
          },
        },
        { $count: 'total_count' },
      ])
      .exec();

    return {
      total_count: countResult?.total_count ?? 0,
      items: rows.map((row) => ({
        id: row.id,
        document_id: row.document_id,
        document_type: row.document_type,
        document_number: row.document_number,
        document_status: row.document_status,
        client_name: row.client_name,
        job_name: row.job_name,
        service_address_summary: row.service_address_summary,
        description: row.description,
        quantity_milli: row.quantity_milli,
        unit_of_measure: row.unit_of_measure,
        vendor_name: row.vendor_name,
        sku_or_part_number: row.sku_or_part_number,
        purchase_status: row.purchase_status,
        internal_unit_cost_minor: row.internal_unit_cost_minor,
        internal_cost_total_minor: row.internal_cost_total_minor,
        customer_total_minor: row.customer_total_minor,
        href: row.href,
      })),
    };
  }

  private async convertedEstimateIds(orgId: Types.ObjectId) {
    const rows = await this.documentModel
      .distinct('source_estimate_id', {
        organization_id: orgId,
        type: 'invoice',
        source_estimate_id: { $type: 'objectId' },
      })
      .exec();
    return rows;
  }

  private serializeDocument(
    raw: OrgDocumentDocument,
    reason: string | null,
  ): DashboardDocument {
    const paymentDisplay =
      raw.type === 'invoice'
        ? computeInvoicePaymentDisplay({
            total_minor: raw.total_minor ?? 0,
            amount_paid_minor: raw.amount_paid_minor ?? 0,
            amount_refunded_minor: raw.amount_refunded_minor ?? 0,
            amount_disputed_minor: raw.amount_disputed_minor ?? 0,
            balance_due_minor: raw.balance_due_minor ?? 0,
            due_date: raw.due_date ?? null,
            status: raw.status,
          })
        : null;

    return {
      id: String(raw._id),
      type: raw.type,
      number: raw.number,
      status:
        raw.type === 'invoice' && paymentDisplay ? paymentDisplay : raw.status,
      client_name: raw.client_snapshot?.display_name ?? 'Client',
      job_name: raw.job_name ?? null,
      service_address_summary: this.formatAddressSummary(
        raw.service_address_snapshot ?? raw.client_snapshot?.service_address,
      ),
      issue_date: this.toIso(raw.issue_date),
      due_date: this.toIso(raw.due_date),
      expiration_date: this.toIso(raw.expiration_date),
      total_minor: raw.total_minor ?? 0,
      balance_due_minor: raw.balance_due_minor ?? 0,
      href: `/dashboard/${raw.type}s/${String(raw._id)}`,
      reason,
    };
  }

  private formatAddressSummary(
    address: Address | null | undefined,
  ): string | null {
    if (!address) {
      return null;
    }
    const cityState = [address.city, address.state]
      .filter((part): part is string => Boolean(part?.trim()))
      .join(', ');
    const parts = [address.street, cityState, address.postal_code]
      .filter((part): part is string => Boolean(part?.trim()))
      .map((part) => part.trim());
    return parts.length > 0 ? parts.join(', ') : null;
  }

  private toIso(value: Date | string | null | undefined): string | null {
    if (!value) {
      return null;
    }
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date.toISOString();
  }

  private async getBusinessTimeZone(organizationId: string) {
    const settings = await this.settingsService.getAppSettings(organizationId);
    return settings.business_timezone || 'America/New_York';
  }
}
