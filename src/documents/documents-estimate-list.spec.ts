import { BadRequestException } from '@nestjs/common';
import { Types } from 'mongoose';
import { DocumentsService } from './documents.service';

const ORG_ID = '507f1f77bcf86cd7994390aa';

function createService(documentModel: Record<string, unknown>) {
  return new DocumentsService(
    documentModel as never,
    { create: jest.fn().mockResolvedValue({}) } as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    { allocateNextNumber: jest.fn() } as never,
    { findActiveDocumentById: jest.fn() } as never,
    { findActiveDocumentById: jest.fn() } as never,
    {
      getSnapshotSource: jest.fn().mockResolvedValue({
        business_timezone: 'America/New_York',
        account: {},
        company: {},
        documents: {},
        preferences: { currency: 'usd', locale: 'en-US' },
      }),
    } as never,
  );
}

describe('DocumentsService.findEstimateSummariesPage', () => {
  it('filters by status, client, amount, email, and stable calendar-date bounds', async () => {
    let capturedFilter: Record<string, unknown> | undefined;
    let capturedSort: Record<string, unknown> | undefined;

    const docs = [
      {
        _id: new Types.ObjectId(),
        organization_id: new Types.ObjectId(ORG_ID),
        type: 'estimate',
        number: 'EST-000010',
        po_number: 'PO-1',
        client_id: new Types.ObjectId('507f1f77bcf86cd7994390ab'),
        job_name: 'Roof',
        service_address_snapshot: {
          street: '1 Main',
          suite: null,
          city: 'Austin',
          state: 'TX',
          postal_code: '78701',
          country: null,
        },
        issue_date: new Date('2026-01-15T12:00:00.000Z'),
        expiration_date: new Date('2026-02-15T00:00:00.000Z'),
        status: 'pending',
        email_state: 'sent',
        sync_state: 'not_synced',
        total_minor: 12_500,
        version: 2,
        client_snapshot: {
          display_name: 'Pat Client',
          company_name: null,
          phone: '555-0100',
          email: 'pat@example.com',
          service_address: null,
        },
        created_at: new Date('2026-01-10T00:00:00.000Z'),
        updated_at: new Date('2026-01-16T00:00:00.000Z'),
      },
    ];

    const service = createService({
      countDocuments: jest.fn().mockReturnValue({
        exec: jest.fn().mockResolvedValue(1),
      }),
      find: jest.fn().mockImplementation((filter: Record<string, unknown>) => {
        capturedFilter = filter;
        return {
          sort: (sort: Record<string, unknown>) => {
            capturedSort = sort;
            return {
              skip: () => ({
                limit: () => ({
                  exec: jest.fn().mockResolvedValue(docs),
                }),
              }),
            };
          },
        };
      }),
    });

    const result = await service.findEstimateSummariesPage(
      {
        status: ['pending'],
        client_id: '507f1f77bcf86cd7994390ab',
        date_from: '2026-01-01',
        date_to: '2026-01-31',
        amount_min_minor: 1000,
        amount_max_minor: 20_000,
        email_state: 'sent',
        search: 'Austin',
        page: 1,
        page_size: 25,
      },
      ORG_ID,
    );

    expect(capturedFilter).toEqual(
      expect.objectContaining({
        type: 'estimate',
        status: 'pending',
        email_state: 'sent',
        total_minor: { $gte: 1000, $lte: 20_000 },
        issue_date: {
          $gte: new Date('2026-01-01T00:00:00.000Z'),
          $lt: new Date('2026-02-01T00:00:00.000Z'),
        },
      }),
    );
    expect(capturedSort).toEqual({ issue_date: -1, _id: -1 });
    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toEqual(
      expect.objectContaining({
        number: 'EST-000010',
        client_name: 'Pat Client',
        service_address_summary: '1 Main, Austin, TX, 78701',
        total_minor: 12_500,
        email_state: 'sent',
      }),
    );
    expect(result.items[0]).not.toHaveProperty('line_items');
    expect(result.items[0]).not.toHaveProperty('private_notes');
  });

  it('rejects inverted amount filters', async () => {
    const service = createService({
      countDocuments: jest.fn(),
      find: jest.fn(),
    });

    await expect(
      service.findEstimateSummariesPage(
        {
          amount_min_minor: 5000,
          amount_max_minor: 1000,
        },
        ORG_ID,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects inverted date filters', async () => {
    const service = createService({
      countDocuments: jest.fn(),
      find: jest.fn(),
    });

    await expect(
      service.findEstimateSummariesPage(
        { date_from: '2026-02-01', date_to: '2026-01-31' },
        ORG_ID,
      ),
    ).rejects.toThrow('date_from cannot be after date_to');
  });

  it('clamps out-of-range pages and uses _id tie-breaker', async () => {
    let capturedSort: Record<string, unknown> | undefined;
    const service = createService({
      countDocuments: jest.fn().mockReturnValue({
        exec: jest.fn().mockResolvedValue(5),
      }),
      find: jest.fn().mockReturnValue({
        sort: (sort: Record<string, unknown>) => {
          capturedSort = sort;
          return {
            skip: (skip: number) => {
              expect(skip).toBe(0);
              return {
                limit: () => ({
                  exec: jest.fn().mockResolvedValue([]),
                }),
              };
            },
          };
        },
      }),
    });

    const result = await service.findEstimateSummariesPage(
      {
        page: 99,
        page_size: 25,
        sort: 'total_minor',
        direction: 'asc',
      },
      ORG_ID,
    );

    expect(result.page).toBe(1);
    expect(result.page_count).toBe(1);
    expect(capturedSort).toEqual({ total_minor: 1, _id: 1 });
  });
});
