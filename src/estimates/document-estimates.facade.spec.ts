import { DocumentEstimatesFacade } from './document-estimates.facade';

describe('DocumentEstimatesFacade', () => {
  it('forces type=estimate on create', async () => {
    const create = jest.fn().mockResolvedValue({ id: 'd1', type: 'estimate' });
    const findDocumentEntity = jest.fn().mockResolvedValue({ id: 'd1' });
    const serializeForEdit = jest
      .fn()
      .mockReturnValue({ id: 'd1', type: 'estimate' });
    const facade = new DocumentEstimatesFacade(
      {
        create,
        findEstimateSummariesPage: jest.fn(),
        findById: jest.fn().mockResolvedValue({ id: 'd1', type: 'estimate' }),
        findDocumentEntity,
        serializeForEdit,
        update: jest.fn(),
        updateLinePurchaseStatuses: jest.fn(),
        transitionStatus: jest.fn(),
        restoreArchived: jest.fn(),
      } as never,
      { convertToInvoice: jest.fn() } as never,
      { enqueueAutoConversionJob: jest.fn() } as never,
    );

    await facade.create(
      {
        client_id: '507f1f77bcf86cd799439011',
        line_items: [],
      } as never,
      {
        user_id: 'u1',
        organization_id: '507f1f77bcf86cd7994390aa',
        role: 'ADMIN',
      } as never,
    );

    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'estimate' }),
      '507f1f77bcf86cd7994390aa',
      'u1',
    );
  });

  it('maps paginated list filters onto document summaries', async () => {
    const findEstimateSummariesPage = jest.fn().mockResolvedValue({
      items: [],
      total: 0,
      page: 1,
      page_size: 25,
      page_count: 1,
    });
    const facade = new DocumentEstimatesFacade(
      {
        create: jest.fn(),
        findEstimateSummariesPage,
        findById: jest.fn(),
        findDocumentEntity: jest.fn(),
        serializeForEdit: jest.fn(),
        update: jest.fn(),
        updateLinePurchaseStatuses: jest.fn(),
        transitionStatus: jest.fn(),
        restoreArchived: jest.fn(),
      } as never,
      { convertToInvoice: jest.fn() } as never,
      { enqueueAutoConversionJob: jest.fn() } as never,
    );

    await facade.findSummariesPage(
      {
        status: ['pending', 'approved'],
        client_id: '507f1f77bcf86cd799439011',
        search: 'roof',
        date_from: '2026-01-01',
        date_to: '2026-01-31',
        amount_min_minor: 1000,
        amount_max_minor: 50000,
        email_state: 'sent',
        sort: 'total_minor',
        direction: 'asc',
        page: 2,
        page_size: 10,
      },
      '507f1f77bcf86cd7994390aa',
    );

    expect(findEstimateSummariesPage).toHaveBeenCalledWith(
      {
        status: ['pending', 'approved'],
        client_id: '507f1f77bcf86cd799439011',
        search: 'roof',
        date_from: '2026-01-01',
        date_to: '2026-01-31',
        amount_min_minor: 1000,
        amount_max_minor: 50000,
        email_state: 'sent',
        sort: 'total_minor',
        direction: 'asc',
        page: 2,
        page_size: 10,
      },
      '507f1f77bcf86cd7994390aa',
    );
  });

  it('archives via status transition', async () => {
    const transitionStatus = jest
      .fn()
      .mockResolvedValue({ status: 'archived' });
    const findById = jest.fn().mockResolvedValue({
      id: 'd1',
      type: 'estimate',
    });
    const findDocumentEntity = jest.fn().mockResolvedValue({ id: 'd1' });
    const serializeForEdit = jest.fn().mockReturnValue({ status: 'archived' });
    const facade = new DocumentEstimatesFacade(
      {
        create: jest.fn(),
        findEstimateSummariesPage: jest.fn(),
        findById,
        findDocumentEntity,
        serializeForEdit,
        update: jest.fn(),
        updateLinePurchaseStatuses: jest.fn(),
        transitionStatus,
        restoreArchived: jest.fn(),
      } as never,
      { convertToInvoice: jest.fn() } as never,
      { enqueueAutoConversionJob: jest.fn() } as never,
    );

    await facade.archive('d1', 3, {
      user_id: 'u1',
      organization_id: '507f1f77bcf86cd7994390aa',
      role: 'ADMIN',
    } as never);

    expect(transitionStatus).toHaveBeenCalledWith(
      'd1',
      { status: 'archived', version: 3 },
      '507f1f77bcf86cd7994390aa',
      'u1',
    );
  });

  it('loads edit payload with internal fields for admin', async () => {
    const entity = { id: 'd1', type: 'estimate' };
    const serializeForEdit = jest.fn().mockReturnValue({
      id: 'd1',
      private_notes: 'secret',
    });
    const facade = new DocumentEstimatesFacade(
      {
        create: jest.fn(),
        findEstimateSummariesPage: jest.fn(),
        findById: jest.fn().mockResolvedValue({ id: 'd1', type: 'estimate' }),
        findDocumentEntity: jest.fn().mockResolvedValue(entity),
        serializeForEdit,
        update: jest.fn(),
        updateLinePurchaseStatuses: jest.fn(),
        transitionStatus: jest.fn(),
        restoreArchived: jest.fn(),
      } as never,
      { convertToInvoice: jest.fn() } as never,
      { enqueueAutoConversionJob: jest.fn() } as never,
    );

    const result = await facade.findForEdit('d1', {
      user_id: 'u1',
      organization_id: '507f1f77bcf86cd7994390aa',
      role: 'ADMIN',
    } as never);

    expect(serializeForEdit).toHaveBeenCalledWith(entity, {
      includeInternalFields: true,
    });
    expect(result).toEqual({ id: 'd1', private_notes: 'secret' });
  });

  it('redacts internal fields for technicians on findById', async () => {
    const entity = { id: 'd1', type: 'estimate' };
    const serializeForEdit = jest.fn().mockReturnValue({
      id: 'd1',
      private_notes: null,
    });
    const facade = new DocumentEstimatesFacade(
      {
        create: jest.fn(),
        findEstimateSummariesPage: jest.fn(),
        findById: jest.fn().mockResolvedValue({ id: 'd1', type: 'estimate' }),
        findDocumentEntity: jest.fn().mockResolvedValue(entity),
        serializeForEdit,
        update: jest.fn(),
        updateLinePurchaseStatuses: jest.fn(),
        transitionStatus: jest.fn(),
        restoreArchived: jest.fn(),
      } as never,
      { convertToInvoice: jest.fn() } as never,
      { enqueueAutoConversionJob: jest.fn() } as never,
    );

    await facade.findById('d1', {
      user_id: 'u1',
      organization_id: '507f1f77bcf86cd7994390aa',
      role: 'TECHNICIAN',
    } as never);

    expect(serializeForEdit).toHaveBeenCalledWith(entity, {
      includeInternalFields: false,
    });
  });
});
