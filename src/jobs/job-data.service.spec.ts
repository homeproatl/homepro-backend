import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { JobDataService } from './job-data.service';

function createSessionMock() {
  return {
    withTransaction: jest.fn(async (callback: () => Promise<unknown>) =>
      callback(),
    ),
    endSession: jest.fn().mockResolvedValue(undefined),
  };
}

function createSessionExecMock<T>(value: T) {
  return {
    session: jest.fn().mockReturnThis(),
    exec: jest.fn().mockResolvedValue(value),
  };
}

describe('JobDataService', () => {
  it('uses the saved service catalog price when adding a job service line', async () => {
    const session = createSessionMock();
    const save = jest.fn().mockResolvedValue(undefined);
    const JobServiceModel = jest
      .fn()
      .mockImplementation((payload: Record<string, unknown>) => ({
        ...payload,
        save,
      }));
    const service = new JobDataService(
      {} as never,
      {} as never,
      {} as never,
      {
        findOneAndUpdate: jest.fn().mockReturnValue(
          createSessionExecMock({
            _id: 'service-1',
            base_price: 125,
          }),
        ),
      } as never,
      {
        db: {
          startSession: jest.fn().mockResolvedValue(session),
        },
        findById: jest.fn().mockReturnValue(
          createSessionExecMock({
            _id: 'job-1',
          }),
        ),
      } as never,
      {} as never,
      JobServiceModel as never,
      {} as never,
    );

    await service.addJobServiceLine('job-1', {
      service_id: 'service-1',
      quantity: 2,
    });

    expect(JobServiceModel).toHaveBeenCalledWith({
      job_id: 'job-1',
      quantity: 2,
      service_id: 'service-1',
      sub_total: 250,
      unit_price_snapshot: 125,
    });
    expect(save).toHaveBeenCalledWith({ session });
    expect(session.endSession).toHaveBeenCalled();
  });

  it('claims the service document inside the transaction before creating a line', async () => {
    const session = createSessionMock();
    const findOneAndUpdate = jest.fn().mockReturnValue(
      createSessionExecMock({
        _id: 'service-1',
        base_price: 125,
      }),
    );
    const service = new JobDataService(
      {} as never,
      {} as never,
      {} as never,
      {
        findOneAndUpdate,
      } as never,
      {
        db: {
          startSession: jest.fn().mockResolvedValue(session),
        },
        findById: jest.fn().mockReturnValue(
          createSessionExecMock({
            _id: 'job-1',
          }),
        ),
      } as never,
      {} as never,
      jest.fn().mockImplementation((payload: Record<string, unknown>) => ({
        ...payload,
        save: jest.fn().mockResolvedValue(undefined),
      })) as never,
      {} as never,
    );

    await service.addJobServiceLine('job-1', {
      service_id: 'service-1',
      quantity: 2,
    });

    expect(findOneAndUpdate).toHaveBeenCalledWith(
      {
        _id: 'service-1',
        is_active: { $ne: false },
        base_price: { $ne: null },
      },
      { $inc: { __v: 1 } },
      expect.objectContaining({
        new: true,
        session,
        timestamps: false,
      }),
    );
  });

  it('rejects adding a service without a saved base price', async () => {
    const session = createSessionMock();
    const service = new JobDataService(
      {} as never,
      {} as never,
      {} as never,
      {
        findOneAndUpdate: jest
          .fn()
          .mockReturnValue(createSessionExecMock(null)),
        findById: jest.fn().mockReturnValue(
          createSessionExecMock({
            _id: 'service-1',
            base_price: null,
            is_active: true,
          }),
        ),
      } as never,
      {
        db: {
          startSession: jest.fn().mockResolvedValue(session),
        },
        findById: jest.fn().mockReturnValue(
          createSessionExecMock({
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

  it('rejects adding an inactive service', async () => {
    const session = createSessionMock();
    const service = new JobDataService(
      {} as never,
      {} as never,
      {} as never,
      {
        findOneAndUpdate: jest
          .fn()
          .mockReturnValue(createSessionExecMock(null)),
        findById: jest.fn().mockReturnValue(
          createSessionExecMock({
            _id: 'service-1',
            is_active: false,
            base_price: 125,
          }),
        ),
      } as never,
      {
        db: {
          startSession: jest.fn().mockResolvedValue(session),
        },
        findById: jest.fn().mockReturnValue(
          createSessionExecMock({
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
    const session = createSessionMock();
    const service = new JobDataService(
      {} as never,
      {} as never,
      {} as never,
      {
        findOneAndUpdate: jest.fn(),
      } as never,
      {
        db: {
          startSession: jest.fn().mockResolvedValue(session),
        },
        findById: jest.fn().mockReturnValue(createSessionExecMock(null)),
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

  it('rejects creating a job for an archived customer', async () => {
    const service = new JobDataService(
      {
        findById: jest.fn().mockReturnValue({
          exec: jest.fn().mockResolvedValue({
            _id: 'customer-1',
            is_archived: true,
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
    );

    await expect(
      service.createJob({
        job_number: 'ABC123',
        title: 'Inspection',
        customer_id: 'customer-1',
        vehicle_id: 'vehicle-1',
      }),
    ).rejects.toThrow(BadRequestException);
  });

  it('rejects creating a job for an inactive assigned user', async () => {
    const service = new JobDataService(
      {
        findById: jest.fn().mockReturnValue({
          exec: jest.fn().mockResolvedValue({
            _id: 'customer-1',
            is_archived: false,
          }),
        }),
      } as never,
      {
        findById: jest.fn().mockReturnValue({
          exec: jest.fn().mockResolvedValue({
            _id: 'vehicle-1',
            customer_id: 'customer-1',
            is_archived: false,
          }),
        }),
      } as never,
      {
        findById: jest.fn().mockReturnValue({
          exec: jest.fn().mockResolvedValue({
            _id: 'user-1',
            is_active: false,
          }),
        }),
      } as never,
      {} as never,
      {
        find: jest.fn().mockReturnValue({
          exec: jest.fn().mockResolvedValue([]),
        }),
      } as never,
      {} as never,
      {} as never,
      {
        vehicleBelongsToCustomer: jest.fn().mockReturnValue(true),
        assertValidScheduleRange: jest.fn(),
        hasAssignedUserConflict: jest.fn().mockReturnValue(false),
      } as never,
    );

    await expect(
      service.createJob({
        job_number: 'ABC123',
        title: 'Inspection',
        customer_id: 'customer-1',
        vehicle_id: 'vehicle-1',
        assigned_user_id: 'user-1',
      }),
    ).rejects.toBeInstanceOf(ConflictException);
  });
});
