import * as bcrypt from 'bcryptjs';
import { ConfigService } from '@nestjs/config';
import { UserRole } from '../common/enums/user-role.enum';
import { UsersService } from './users.service';

describe('UsersService', () => {
  const mockConfigService = {
    getOrThrow: jest.fn((key: string) => {
      const values: Record<string, string> = {
        OWNER_ADMIN_EMAIL: 'joseph@admin.com',
        OWNER_ADMIN_NAME: 'Home Pro',
        OWNER_ADMIN_PASSWORD: 'password-123',
      };
      return values[key];
    }),
  } as unknown as ConfigService;

  const mockOrganizationsService = {
    ensureFixedCompany: jest.fn().mockResolvedValue({
      _id: '507f1f77bcf86cd7994390aa',
      normalized_slug: 'joseph-company',
    }),
  } as never;

  it('does not create a duplicate owner admin when one already exists', async () => {
    const existingUser = {
      id: 'existing-id',
      name: 'Home Pro',
      email: 'joseph@admin.com',
      password_hash: await bcrypt.hash('password-123', 1),
      role: UserRole.ADMIN,
      is_active: true,
      token_version: 0,
      refresh_token_hash: 'existing-refresh-hash',
      organization_id: '507f1f77bcf86cd7994390aa',
      save: jest.fn(),
    };

    const create = jest.fn();
    const findOneExec = jest.fn().mockResolvedValue(existingUser);
    const findOne = jest.fn().mockReturnValue({ exec: findOneExec });

    const usersService = new UsersService(
      { findOne, create } as never,
      mockConfigService,
      mockOrganizationsService,
    );

    const seeded = await usersService.ensureOwnerAdmin();

    expect(seeded).toBe(existingUser);
    expect(create).not.toHaveBeenCalled();
    expect(existingUser.save).not.toHaveBeenCalled();
  });

  it('upgrades an existing matching user to ADMIN when needed', async () => {
    const existingUser = {
      id: 'existing-id',
      name: 'Old Admin',
      email: 'joseph@admin.com',
      password_hash: await bcrypt.hash('password-123', 1),
      role: UserRole.ADMIN,
      is_active: false,
      token_version: 1,
      refresh_token_hash: 'existing-refresh-hash',
      save: jest.fn().mockResolvedValue(undefined),
    };

    const create = jest.fn();
    const findOneExec = jest.fn().mockResolvedValue(existingUser);
    const findOne = jest.fn().mockReturnValue({ exec: findOneExec });

    const usersService = new UsersService(
      { findOne, create } as never,
      mockConfigService,
      mockOrganizationsService,
    );

    const seeded = await usersService.ensureOwnerAdmin();

    expect(seeded).toBe(existingUser);
    expect(existingUser.name).toBe('Home Pro');
    expect(existingUser.role).toBe(UserRole.ADMIN);
    expect(existingUser.is_active).toBe(true);
    expect(existingUser.save).toHaveBeenCalledTimes(1);
    expect(create).not.toHaveBeenCalled();
  });

  it('creates owner admin when it does not exist', async () => {
    const createdUser = { id: 'new-id', email: 'joseph@admin.com' };
    const create = jest.fn().mockResolvedValue(createdUser);
    const findOneExec = jest.fn().mockResolvedValue(null);
    const findOne = jest.fn().mockReturnValue({ exec: findOneExec });

    const usersService = new UsersService(
      { findOne, create } as never,
      mockConfigService,
      mockOrganizationsService,
    );

    const seeded = await usersService.ensureOwnerAdmin();

    expect(seeded).toBe(createdUser);
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        role: UserRole.ADMIN,
        email: 'joseph@admin.com',
      }),
    );
  });

  it('updates the existing owner admin password to match the configured bootstrap password', async () => {
    const existingUser = {
      id: 'existing-id',
      name: 'Home Pro',
      email: 'joseph@admin.com',
      password_hash: await bcrypt.hash('old-password', 1),
      role: UserRole.ADMIN,
      is_active: true,
      token_version: 4,
      refresh_token_hash: 'existing-refresh-hash',
      save: jest.fn().mockResolvedValue(undefined),
    };

    const create = jest.fn();
    const findOneExec = jest.fn().mockResolvedValue(existingUser);
    const findOne = jest.fn().mockReturnValue({ exec: findOneExec });

    const usersService = new UsersService(
      { findOne, create } as never,
      mockConfigService,
      mockOrganizationsService,
    );

    await usersService.ensureOwnerAdmin();

    await expect(
      bcrypt.compare('password-123', existingUser.password_hash),
    ).resolves.toBe(true);
    expect(existingUser.token_version).toBe(5);
    expect(existingUser.refresh_token_hash).toBeNull();
    expect(existingUser.save).toHaveBeenCalledTimes(1);
  });
});
