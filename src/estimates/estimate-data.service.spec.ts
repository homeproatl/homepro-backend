import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { EstimateDataService } from './estimate-data.service';
import { EstimateStatus } from '../common/enums/estimate-status.enum';
import { UserRole } from '../common/enums/user-role.enum';

describe('EstimateDataService', () => {
  function createService(overrides?: {
    customerModel?: object;
    vehicleModel?: object;
    userModel?: object;
    serviceModel?: object;
    estimateModel?: object;
    estimateDomainService?: object;
  }) {
    return new EstimateDataService(
      (overrides?.customerModel ?? {}) as never,
      (overrides?.vehicleModel ?? {}) as never,
      (overrides?.userModel ?? {}) as never,
      (overrides?.serviceModel ?? {}) as never,
      (overrides?.estimateModel ?? {}) as never,
      {} as never,
      (overrides?.estimateDomainService ?? {
        vehicleBelongsToCustomer: jest.fn().mockReturnValue(true),
        assertValidScheduleRange: jest.fn(),
        hasAssignedUserConflict: jest.fn().mockReturnValue(false),
      }) as never,
    );
  }

  it('creates a estimate with grouped service totals computed on the backend', async () => {
    const create = jest.fn().mockResolvedValue({ id: 'estimate-1' });
    const service = createService({
      customerModel: {
        findById: jest.fn().mockReturnValue({
          exec: jest.fn().mockResolvedValue({
            _id: 'customer-1',
            is_archived: false,
          }),
        }),
      },
      vehicleModel: {
        findById: jest.fn().mockReturnValue({
          exec: jest.fn().mockResolvedValue({
            _id: 'vehicle-1',
            customer_id: 'customer-1',
            is_archived: false,
          }),
        }),
      },
      userModel: {
        find: jest.fn().mockReturnValue({
          select: jest.fn().mockReturnValue({
            exec: jest.fn().mockResolvedValue([
              {
                _id: '507f1f77bcf86cd799439014',
                is_active: true,
                role: UserRole.TECHNICIAN,
              },
            ]),
          }),
        }),
      },
      serviceModel: {
        find: jest.fn().mockReturnValue({
          select: jest.fn().mockReturnValue({
            exec: jest.fn().mockResolvedValue([
              { _id: 'svc-1', name: 'Oil Service', is_active: true },
            ]),
          }),
        }),
      },
      estimateModel: {
        create,
      },
    });

    await service.createEstimate({
      estimate_number: 'EST-001',
      title: 'Oil Service',
      customer_id: 'customer-1',
      vehicle_id: 'vehicle-1',
      services: [
        {
          canned_service_id: 'svc-1',
          name: 'Oil Service',
          labor_lines: [
            {
              description: 'Oil labor',
              assigned_user_id: '507f1f77bcf86cd799439014',
              hours: 1,
              rate: 100,
              discount_percent: 0,
            },
          ],
          part_lines: [
            {
              name: 'Engine oil',
              quantity: 1,
              cost: 20,
              price: 35,
              discount_percent: 0,
            },
          ],
        },
      ],
    });

    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        labor_total: 100,
        parts_total: 35,
        total: 135,
        services: [
          expect.objectContaining({
            canned_service_id: 'svc-1',
            labor_total: 100,
            parts_total: 35,
            total: 135,
            labor_lines: [
              expect.objectContaining({
                assigned_user_id: expect.anything(),
              }),
            ],
          }),
        ],
      }),
    );
  });

  it('preserves provided estimate tax totals when creating an estimate', async () => {
    const create = jest.fn().mockResolvedValue({ id: 'estimate-1' });
    const service = createService({
      customerModel: {
        findById: jest.fn().mockReturnValue({
          exec: jest.fn().mockResolvedValue({
            _id: 'customer-1',
            is_archived: false,
          }),
        }),
      },
      vehicleModel: {
        findById: jest.fn().mockReturnValue({
          exec: jest.fn().mockResolvedValue({
            _id: 'vehicle-1',
            customer_id: 'customer-1',
            is_archived: false,
          }),
        }),
      },
      userModel: {
        find: jest.fn().mockReturnValue({
          select: jest.fn().mockReturnValue({
            exec: jest.fn().mockResolvedValue([]),
          }),
        }),
      },
      serviceModel: {
        find: jest.fn().mockReturnValue({
          select: jest.fn().mockReturnValue({
            exec: jest.fn().mockResolvedValue([]),
          }),
        }),
      },
      estimateModel: {
        create,
      },
    });

    await service.createEstimate({
      estimate_number: 'EST-002',
      title: 'Front Wheel Bearing',
      customer_id: 'customer-1',
      vehicle_id: 'vehicle-1',
      subtotal: 460,
      tax_rate: 8.875,
      tax_amount: 40.83,
      total: 500.83,
      services: [
        {
          name: 'Front Wheel Bearing',
          labor_lines: [
            {
              description: 'Labor',
              hours: 1,
              rate: 260,
              discount_percent: 0,
            },
          ],
          part_lines: [
            {
              name: 'Wheel Bearing',
              quantity: 1,
              cost: 120,
              price: 200,
              discount_percent: 0,
            },
          ],
        },
      ],
    });

    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        labor_total: 260,
        parts_total: 200,
        subtotal: 460,
        tax_rate: 8.875,
        tax_amount: 40.83,
        total: 460,
      }),
    );
  });

  it('rejects missing canned services when referenced by a estimate service group', async () => {
    const service = createService({
      customerModel: {
        findById: jest.fn().mockReturnValue({
          exec: jest.fn().mockResolvedValue({
            _id: 'customer-1',
            is_archived: false,
          }),
        }),
      },
      vehicleModel: {
        findById: jest.fn().mockReturnValue({
          exec: jest.fn().mockResolvedValue({
            _id: 'vehicle-1',
            customer_id: 'customer-1',
            is_archived: false,
          }),
        }),
      },
      serviceModel: {
        find: jest.fn().mockReturnValue({
          select: jest.fn().mockReturnValue({
            exec: jest.fn().mockResolvedValue([]),
          }),
        }),
      },
      estimateModel: {
        create: jest.fn(),
      },
    });

    await expect(
      service.createEstimate({
        estimate_number: 'EST-001',
        title: 'Oil Service',
        customer_id: 'customer-1',
        vehicle_id: 'vehicle-1',
        services: [
          {
            canned_service_id: 'svc-1',
            name: 'Oil Service',
            labor_lines: [
              {
                description: 'Oil labor',
                hours: 1,
                rate: 100,
                discount_percent: 0,
              },
            ],
            part_lines: [],
          },
        ],
      }),
    ).rejects.toThrow(NotFoundException);
  });

  it('rejects assigned users with scheduling conflicts', async () => {
    const service = createService({
      customerModel: {
        findById: jest.fn().mockReturnValue({
          exec: jest.fn().mockResolvedValue({
            _id: 'customer-1',
            is_archived: false,
          }),
        }),
      },
      vehicleModel: {
        findById: jest.fn().mockReturnValue({
          exec: jest.fn().mockResolvedValue({
            _id: 'vehicle-1',
            customer_id: 'customer-1',
            is_archived: false,
          }),
        }),
      },
      userModel: {
        findById: jest.fn().mockReturnValue({
          exec: jest.fn().mockResolvedValue({
            _id: 'user-1',
            is_active: true,
          }),
        }),
      },
      serviceModel: {
        find: jest.fn().mockReturnValue({
          select: jest.fn().mockReturnValue({
            exec: jest.fn().mockResolvedValue([]),
          }),
        }),
      },
      estimateModel: {
        find: jest.fn().mockReturnValue({
          exec: jest.fn().mockResolvedValue([
            {
              _id: 'estimate-existing',
              assigned_user_id: 'user-1',
              scheduled_start: new Date('2026-03-20T09:00:00.000Z'),
              scheduled_end: new Date('2026-03-20T11:00:00.000Z'),
              estimate_status: EstimateStatus.SCHEDULED,
            },
          ]),
        }),
        create: jest.fn(),
      },
      estimateDomainService: {
        vehicleBelongsToCustomer: jest.fn().mockReturnValue(true),
        assertValidScheduleRange: jest.fn(),
        hasAssignedUserConflict: jest.fn().mockReturnValue(true),
      },
    });

    await expect(
      service.createEstimate({
        estimate_number: 'EST-001',
        title: 'Brake Service',
        customer_id: 'customer-1',
        vehicle_id: 'vehicle-1',
        assigned_user_id: 'user-1',
        scheduled_start: new Date('2026-03-20T10:00:00.000Z'),
        scheduled_end: new Date('2026-03-20T12:00:00.000Z'),
        services: [
          {
            name: 'Brake Service',
            labor_lines: [
              {
                description: 'Brake labor',
                hours: 1,
                rate: 100,
                discount_percent: 0,
              },
            ],
            part_lines: [],
          },
        ],
      }),
    ).rejects.toThrow(ConflictException);
  });

  it('rejects estimates without at least one grouped service', async () => {
    const service = createService({
      customerModel: {
        findById: jest.fn().mockReturnValue({
          exec: jest.fn().mockResolvedValue({
            _id: 'customer-1',
            is_archived: false,
          }),
        }),
      },
      vehicleModel: {
        findById: jest.fn().mockReturnValue({
          exec: jest.fn().mockResolvedValue({
            _id: 'vehicle-1',
            customer_id: 'customer-1',
            is_archived: false,
          }),
        }),
      },
      estimateModel: {
        create: jest.fn(),
      },
    });

    await expect(
      service.createEstimate({
        estimate_number: 'EST-001',
        title: 'Oil Service',
        customer_id: 'customer-1',
        vehicle_id: 'vehicle-1',
        services: [],
      }),
    ).rejects.toThrow(BadRequestException);
  });

  it('rejects grouped services without labor or part rows', async () => {
    const service = createService({
      customerModel: {
        findById: jest.fn().mockReturnValue({
          exec: jest.fn().mockResolvedValue({
            _id: 'customer-1',
            is_archived: false,
          }),
        }),
      },
      vehicleModel: {
        findById: jest.fn().mockReturnValue({
          exec: jest.fn().mockResolvedValue({
            _id: 'vehicle-1',
            customer_id: 'customer-1',
            is_archived: false,
          }),
        }),
      },
      estimateModel: {
        create: jest.fn(),
      },
    });

    await expect(
      service.createEstimate({
        estimate_number: 'EST-001',
        title: 'Oil Service',
        customer_id: 'customer-1',
        vehicle_id: 'vehicle-1',
        services: [
          {
            name: 'Empty Service',
            labor_lines: [],
            part_lines: [],
          },
        ],
      }),
    ).rejects.toThrow(
      'Each service must include at least one labor or part row.',
    );
  });

  it('rejects inactive canned services on newly attached grouped services', async () => {
    const service = createService({
      customerModel: {
        findById: jest.fn().mockReturnValue({
          exec: jest.fn().mockResolvedValue({
            _id: 'customer-1',
            is_archived: false,
          }),
        }),
      },
      vehicleModel: {
        findById: jest.fn().mockReturnValue({
          exec: jest.fn().mockResolvedValue({
            _id: 'vehicle-1',
            customer_id: 'customer-1',
            is_archived: false,
          }),
        }),
      },
      serviceModel: {
        find: jest.fn().mockReturnValue({
          select: jest.fn().mockReturnValue({
            exec: jest.fn().mockResolvedValue([
              { _id: 'svc-1', name: 'Oil Service', is_active: false },
            ]),
          }),
        }),
      },
      estimateModel: {
        create: jest.fn(),
      },
    });

    await expect(
      service.createEstimate({
        estimate_number: 'EST-001',
        title: 'Oil Service',
        customer_id: 'customer-1',
        vehicle_id: 'vehicle-1',
        services: [
          {
            canned_service_id: 'svc-1',
            name: 'Oil Service',
            labor_lines: [
              {
                description: 'Oil labor',
                hours: 1,
                rate: 100,
                discount_percent: 0,
              },
            ],
            part_lines: [],
          },
        ],
      }),
    ).rejects.toThrow(BadRequestException);
  });

  it('rejects inactive labor assignees on labor lines', async () => {
    const service = createService({
      customerModel: {
        findById: jest.fn().mockReturnValue({
          exec: jest.fn().mockResolvedValue({
            _id: 'customer-1',
            is_archived: false,
          }),
        }),
      },
      vehicleModel: {
        findById: jest.fn().mockReturnValue({
          exec: jest.fn().mockResolvedValue({
            _id: 'vehicle-1',
            customer_id: 'customer-1',
            is_archived: false,
          }),
        }),
      },
      userModel: {
        find: jest.fn().mockReturnValue({
          select: jest.fn().mockReturnValue({
            exec: jest.fn().mockResolvedValue([
              {
                _id: '507f1f77bcf86cd799439015',
                is_active: false,
                role: UserRole.TECHNICIAN,
              },
            ]),
          }),
        }),
      },
      estimateModel: {
        create: jest.fn(),
      },
    });

    await expect(
      service.createEstimate({
        estimate_number: 'EST-001',
        title: 'Brake Service',
        customer_id: 'customer-1',
        vehicle_id: 'vehicle-1',
        services: [
          {
            name: 'Brake Service',
            labor_lines: [
              {
                description: 'Brake labor',
                assigned_user_id: '507f1f77bcf86cd799439015',
                hours: 1,
                rate: 100,
                discount_percent: 0,
              },
            ],
            part_lines: [],
          },
        ],
      }),
    ).rejects.toThrow(ConflictException);
  });

  it('preserves historical labor assignees when they are no longer active', async () => {
    const save = jest.fn().mockResolvedValue(undefined);
    const service = createService({
      customerModel: {
        findById: jest.fn().mockReturnValue({
          exec: jest.fn().mockResolvedValue({
            _id: 'customer-1',
            is_archived: false,
          }),
        }),
      },
      vehicleModel: {
        findById: jest.fn().mockReturnValue({
          exec: jest.fn().mockResolvedValue({
            _id: 'vehicle-1',
            customer_id: 'customer-1',
            is_archived: false,
          }),
        }),
      },
      userModel: {
        find: jest.fn().mockReturnValue({
          select: jest.fn().mockReturnValue({
            exec: jest.fn().mockResolvedValue([
              {
                _id: '507f1f77bcf86cd799439015',
                is_active: false,
                role: UserRole.TECHNICIAN,
              },
            ]),
          }),
        }),
      },
      estimateModel: {
        find: jest.fn().mockReturnValue({
          exec: jest.fn().mockResolvedValue([]),
        }),
      },
    });

    const estimate = {
      _id: 'estimate-1',
      title: 'Brake Service',
      customer_id: 'customer-1',
      vehicle_id: 'vehicle-1',
      assigned_user_id: null,
      complaint_or_request: null,
      notes: null,
      payment_type: 'POS_CARD',
      due_date: null,
      services: [
        {
          canned_service_id: null,
          name: 'Brake Service',
          labor_lines: [
            {
              description: 'Brake labor',
              assigned_user_id: '507f1f77bcf86cd799439015',
              hours: 1,
              rate: 100,
              discount_percent: 0,
            },
          ],
          part_lines: [],
        },
      ],
      save,
    };

    await expect(
      service.applyEstimateUpdate(estimate as never, {
        title: 'Brake Service',
        customer_id: 'customer-1',
        vehicle_id: 'vehicle-1',
        services: [
          {
            name: 'Brake Service',
            labor_lines: [
              {
                description: 'Brake labor',
                assigned_user_id: '507f1f77bcf86cd799439015',
                hours: 1,
                rate: 100,
                discount_percent: 0,
              },
            ],
            part_lines: [],
          },
        ],
      }),
    ).resolves.toBe(estimate);
  });

  it('preserves provided estimate tax totals when updating an estimate', async () => {
    const save = jest.fn().mockResolvedValue(undefined);
    const service = createService({
      customerModel: {
        findById: jest.fn().mockReturnValue({
          exec: jest.fn().mockResolvedValue({
            _id: 'customer-1',
            is_archived: false,
          }),
        }),
      },
      vehicleModel: {
        findById: jest.fn().mockReturnValue({
          exec: jest.fn().mockResolvedValue({
            _id: 'vehicle-1',
            customer_id: 'customer-1',
            is_archived: false,
          }),
        }),
      },
      userModel: {
        find: jest.fn().mockReturnValue({
          select: jest.fn().mockReturnValue({
            exec: jest.fn().mockResolvedValue([]),
          }),
        }),
      },
      serviceModel: {
        find: jest.fn().mockReturnValue({
          select: jest.fn().mockReturnValue({
            exec: jest.fn().mockResolvedValue([]),
          }),
        }),
      },
      estimateModel: {
        find: jest.fn().mockReturnValue({
          exec: jest.fn().mockResolvedValue([]),
        }),
      },
    });

    const estimate = {
      _id: 'estimate-2',
      title: 'Front Wheel Bearing',
      customer_id: 'customer-1',
      vehicle_id: 'vehicle-1',
      assigned_user_id: null,
      complaint_or_request: null,
      notes: null,
      payment_type: 'POS_CARD',
      due_date: null,
      services: [],
      labor_total: 0,
      parts_total: 0,
      subtotal: 0,
      tax_rate: 0,
      tax_amount: 0,
      total: 0,
      save,
    };

    await service.applyEstimateUpdate(estimate as never, {
      title: 'Front Wheel Bearing',
      customer_id: 'customer-1',
      vehicle_id: 'vehicle-1',
      subtotal: 460,
      tax_rate: 8.875,
      tax_amount: 40.83,
      total: 500.83,
      services: [
        {
          name: 'Front Wheel Bearing',
          labor_lines: [
            {
              description: 'Labor',
              hours: 1,
              rate: 260,
              discount_percent: 0,
            },
          ],
          part_lines: [
            {
              name: 'Wheel Bearing',
              quantity: 1,
              cost: 120,
              price: 200,
              discount_percent: 0,
            },
          ],
        },
      ],
    });

    expect(estimate.labor_total).toBe(260);
    expect(estimate.parts_total).toBe(200);
    expect(estimate.subtotal).toBe(460);
    expect(estimate.tax_rate).toBe(8.875);
    expect(estimate.tax_amount).toBe(40.83);
    expect(estimate.total).toBe(460);
  });

  it('allows admin users on labor lines', async () => {
    const create = jest.fn().mockResolvedValue({ id: 'estimate-1' });
    const service = createService({
      customerModel: {
        findById: jest.fn().mockReturnValue({
          exec: jest.fn().mockResolvedValue({
            _id: 'customer-1',
            is_archived: false,
          }),
        }),
      },
      vehicleModel: {
        findById: jest.fn().mockReturnValue({
          exec: jest.fn().mockResolvedValue({
            _id: 'vehicle-1',
            customer_id: 'customer-1',
            is_archived: false,
          }),
        }),
      },
      userModel: {
        find: jest.fn().mockReturnValue({
          select: jest.fn().mockReturnValue({
            exec: jest.fn().mockResolvedValue([
              {
                _id: '507f1f77bcf86cd799439016',
                is_active: true,
                role: UserRole.ADMIN,
              },
            ]),
          }),
        }),
      },
      estimateModel: {
        create,
      },
    });

    await service.createEstimate({
      estimate_number: 'EST-001',
      title: 'Brake Service',
      customer_id: 'customer-1',
      vehicle_id: 'vehicle-1',
      services: [
        {
          name: 'Brake Service',
          labor_lines: [
            {
              description: 'Brake labor',
              assigned_user_id: '507f1f77bcf86cd799439016',
              hours: 1,
              rate: 100,
              discount_percent: 0,
            },
          ],
          part_lines: [],
        },
      ],
    });

    expect(create).toHaveBeenCalled();
  });
});
