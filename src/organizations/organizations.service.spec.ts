import { Types } from 'mongoose';
import { ConflictException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { OrganizationsService } from './organizations.service';

describe('OrganizationsService', () => {
  const orgId = new Types.ObjectId();

  function buildService(modelOverrides: Record<string, unknown> = {}) {
    const organizationModel = {
      findOne: jest.fn().mockReturnValue({
        exec: jest.fn().mockResolvedValue(null),
      }),
      countDocuments: jest.fn().mockReturnValue({
        exec: jest.fn().mockResolvedValue(0),
      }),
      create: jest.fn().mockResolvedValue({
        _id: orgId,
        name: 'Home Pro',
        normalized_slug: 'joseph-company',
        is_active: true,
      }),
      findById: jest.fn().mockReturnValue({
        exec: jest.fn().mockResolvedValue({
          _id: orgId,
          is_active: true,
        }),
      }),
      ...modelOverrides,
    };
    const configService = {
      get: jest.fn().mockReturnValue(undefined),
    } as unknown as ConfigService;

    return {
      service: new OrganizationsService(
        organizationModel as never,
        configService,
      ),
      organizationModel,
    };
  }

  it('creates the fixed company idempotently when none exists', async () => {
    const { service, organizationModel } = buildService();
    const created = await service.ensureFixedCompany();
    expect(created.normalized_slug).toBe('joseph-company');
    expect(organizationModel.create).toHaveBeenCalled();
  });

  it('refuses to create a second organization outside test fixtures', async () => {
    const { service } = buildService({
      findOne: jest.fn().mockReturnValue({
        exec: jest.fn().mockResolvedValue(null),
      }),
      countDocuments: jest.fn().mockReturnValue({
        exec: jest.fn().mockResolvedValue(1),
      }),
    });

    await expect(service.ensureFixedCompany()).rejects.toThrow(
      ConflictException,
    );
  });

  it('allows a synthetic second organization only for isolated tests', async () => {
    const { service, organizationModel } = buildService({
      findOne: jest.fn().mockReturnValue({
        exec: jest.fn().mockResolvedValue(null),
      }),
      countDocuments: jest.fn().mockReturnValue({
        exec: jest.fn().mockResolvedValue(1),
      }),
      create: jest.fn().mockResolvedValue({
        _id: new Types.ObjectId(),
        name: 'Other Co',
        normalized_slug: 'other-co',
        is_active: true,
      }),
    });

    await expect(
      service.createSyntheticTestOrganization({
        name: 'Other Co',
        slug: 'other-co',
      }),
    ).resolves.toEqual(
      expect.objectContaining({
        normalized_slug: 'other-co',
      }),
    );
    expect(organizationModel.create).toHaveBeenCalled();
  });
});
