import { InvoicesService } from './invoices.service';
import { startOfBusinessCalendarDateUtc } from '../common/utils/business-time';

describe('InvoicesService', () => {
  const actor = {
    user_id: '507f1f77bcf86cd7994390ac',
    organization_id: '507f1f77bcf86cd7994390aa',
    role: 'ADMIN',
    email: 'a@b.co',
    name: 'Admin',
  } as const;

  const settingsService = {
    getAppSettings: jest.fn().mockResolvedValue({
      business_timezone: 'America/New_York',
    }),
  };

  it('forces type=invoice on create', async () => {
    const create = jest.fn().mockResolvedValue({ id: '1', type: 'invoice' });
    const service = new InvoicesService(
      { create } as never,
      settingsService as never,
      { find: jest.fn(), countDocuments: jest.fn() } as never,
    );

    await service.create(
      {
        client_id: '507f1f77bcf86cd7994390ab',
        line_items: [
          {
            sort_order: 0,
            line_type: 'service',
            description: 'Work',
            rate_minor: 1000,
            quantity_milli: 1000,
          },
        ],
      } as never,
      actor as never,
    );

    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'invoice' }),
      actor.organization_id,
      actor.user_id,
    );
  });

  it('returns a scoped invoice summary page by default', async () => {
    const serializeInvoiceSummary = jest.fn();
    let capturedFilter: Record<string, unknown> | undefined;
    const service = new InvoicesService(
      { serializeInvoiceSummary } as never,
      settingsService as never,
      {
        countDocuments: jest.fn().mockImplementation((filter) => {
          capturedFilter = filter;
          return { exec: jest.fn().mockResolvedValue(0) };
        }),
        find: jest.fn().mockReturnValue({
          sort: () => ({
            skip: () => ({
              limit: () => ({ exec: jest.fn().mockResolvedValue([]) }),
            }),
          }),
        }),
      } as never,
    );

    const page = await service.findAll({}, actor.organization_id);

    expect(capturedFilter).toEqual(
      expect.objectContaining({ type: 'invoice' }),
    );
    expect(page).toEqual({
      items: [],
      total: 0,
      page: 1,
      page_size: 25,
      page_count: 1,
    });
  });

  it('maps the visible active segment to issued or sent invoices with a positive balance', async () => {
    let capturedFilter: Record<string, unknown> | undefined;
    const service = new InvoicesService(
      { serializeInvoiceSummary: jest.fn() } as never,
      settingsService as never,
      {
        countDocuments: jest.fn().mockImplementation((filter) => {
          capturedFilter = filter;
          return { exec: jest.fn().mockResolvedValue(0) };
        }),
        find: jest.fn().mockReturnValue({
          sort: () => ({
            skip: () => ({
              limit: () => ({ exec: jest.fn().mockResolvedValue([]) }),
            }),
          }),
        }),
      } as never,
    );

    await service.findAll({ segment: 'active' }, actor.organization_id);

    expect(capturedFilter).toEqual(
      expect.objectContaining({
        type: 'invoice',
        status: { $in: ['issued', 'sent'] },
        balance_due_minor: { $gt: 0 },
      }),
    );
  });

  it('maps paid and overdue segments to their exact balance predicates', async () => {
    const capturedFilters: Record<string, unknown>[] = [];
    const service = new InvoicesService(
      { serializeInvoiceSummary: jest.fn() } as never,
      settingsService as never,
      {
        countDocuments: jest.fn().mockImplementation((filter: unknown) => {
          capturedFilters.push(filter as Record<string, unknown>);
          return { exec: jest.fn().mockResolvedValue(0) };
        }),
        find: jest.fn().mockReturnValue({
          sort: () => ({
            skip: () => ({
              limit: () => ({ exec: jest.fn().mockResolvedValue([]) }),
            }),
          }),
        }),
      } as never,
    );

    await service.findAll({ segment: 'paid' }, actor.organization_id);
    await service.findAll({ segment: 'overdue' }, actor.organization_id);

    expect(capturedFilters[0]).toEqual(
      expect.objectContaining({
        balance_due_minor: { $lte: 0 },
        amount_paid_minor: { $gt: 0 },
        status: { $nin: ['void', 'archived'] },
      }),
    );
    expect(capturedFilters[1]).toEqual(
      expect.objectContaining({
        status: { $in: ['issued', 'sent'] },
        balance_due_minor: { $gt: 0 },
        due_date: {
          $lt: startOfBusinessCalendarDateUtc(new Date(), 'America/New_York'),
        },
      }),
    );
  });

  it('searches invoices by job name and snapshotted service address context', async () => {
    let capturedFilter: Record<string, unknown> | undefined;
    const service = new InvoicesService(
      { serializeInvoiceSummary: jest.fn() } as never,
      settingsService as never,
      {
        countDocuments: jest.fn().mockReturnValue({
          exec: jest.fn().mockResolvedValue(0),
        }),
        find: jest.fn().mockImplementation((filter) => {
          capturedFilter = filter;
          return {
            sort: () => ({
              skip: () => ({
                limit: () => ({
                  exec: jest.fn().mockResolvedValue([]),
                }),
              }),
            }),
          };
        }),
      } as never,
    );

    await service.findAll(
      { search: 'Decatur' } as never,
      actor.organization_id,
    );

    expect(capturedFilter).toEqual(
      expect.objectContaining({
        type: 'invoice',
        $and: [
          expect.objectContaining({
            $or: expect.arrayContaining([
              { job_name: expect.any(RegExp) },
              { 'service_address_snapshot.street': expect.any(RegExp) },
              { 'service_address_snapshot.city': expect.any(RegExp) },
              { 'service_address_snapshot.state': expect.any(RegExp) },
              { 'client_snapshot.service_address.city': expect.any(RegExp) },
            ]),
          }),
        ],
      }),
    );
  });

  it('rejects unsupported invoice status filters', async () => {
    const service = new InvoicesService(
      { findAll: jest.fn() } as never,
      settingsService as never,
      { find: jest.fn(), countDocuments: jest.fn() } as never,
    );

    await expect(
      service.findAll({ status: 'approved' } as never, actor.organization_id),
    ).rejects.toMatchObject({
      response: expect.objectContaining({
        code: 'INVALID_INVOICE_STATUS_FILTER',
      }),
    });
  });
});
