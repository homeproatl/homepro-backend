import { BadRequestException, NotFoundException } from '@nestjs/common';
import { DataLayerService } from './data-layer.service';

describe('DataLayerService', () => {
  function createExecMock<T>(value: T) {
    return {
      exec: jest.fn().mockResolvedValue(value),
    };
  }

  it('uses the saved service catalog price when adding a job service line', async () => {
    const jobServiceCreate = jest.fn().mockResolvedValue(undefined);
    const service = new DataLayerService(
      {} as never,
      {} as never,
      {} as never,
      {
        findById: jest.fn().mockReturnValue(
          createExecMock({
            _id: 'service-1',
            base_price: 125,
          }),
        ),
      } as never,
      {
        findById: jest.fn().mockReturnValue(
          createExecMock({
            _id: 'job-1',
          }),
        ),
      } as never,
      {} as never,
      {
        create: jobServiceCreate,
      } as never,
      {} as never,
    );

    await service.addJobServiceLine('job-1', {
      service_id: 'service-1',
      quantity: 2,
    });

    expect(jobServiceCreate).toHaveBeenCalledWith({
      job_id: 'job-1',
      quantity: 2,
      service_id: 'service-1',
      sub_total: 250,
      unit_price_snapshot: 125,
    });
  });

  it('rejects adding a service without a saved base price', async () => {
    const service = new DataLayerService(
      {} as never,
      {} as never,
      {} as never,
      {
        findById: jest.fn().mockReturnValue(
          createExecMock({
            _id: 'service-1',
            base_price: null,
          }),
        ),
      } as never,
      {
        findById: jest.fn().mockReturnValue(
          createExecMock({
            _id: 'job-1',
          }),
        ),
      } as never,
      {} as never,
      {
        create: jest.fn(),
      } as never,
      {} as never,
    );

    await expect(
      service.addJobServiceLine('job-1', {
        service_id: 'service-1',
        quantity: 1,
      }),
    ).rejects.toThrow(BadRequestException);
  });

  it('rejects adding a service when the job does not exist', async () => {
    const service = new DataLayerService(
      {} as never,
      {} as never,
      {} as never,
      {
        findById: jest.fn(),
      } as never,
      {
        findById: jest.fn().mockReturnValue(createExecMock(null)),
      } as never,
      {} as never,
      {
        create: jest.fn(),
      } as never,
      {} as never,
    );

    await expect(
      service.addJobServiceLine('job-1', {
        service_id: 'service-1',
        quantity: 1,
      }),
    ).rejects.toThrow(NotFoundException);
  });
});
