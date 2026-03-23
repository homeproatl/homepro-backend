import { ConfigService } from '@nestjs/config';
import { UserRole } from '../common/enums/user-role.enum';
import { UsersService } from './users.service';

describe('UsersService', () => {
  const mockConfigService = {
    getOrThrow: jest.fn((key: string) => {
      const values: Record<string, string> = {
        SUPER_ADMIN_EMAIL: 'rico@admin.com',
        SUPER_ADMIN_NAME: 'Rico',
        SUPER_ADMIN_PASSWORD: 'password-123',
      };
      return values[key];
    }),
  } as unknown as ConfigService;

  it('does not create a duplicate super admin when one already exists', async () => {
    const existingUser = {
      id: 'existing-id',
      name: 'Rico',
      email: 'rico@admin.com',
      role: UserRole.SUPER_ADMIN,
      is_active: true,
      save: jest.fn(),
    };

    const create = jest.fn();
    const findOneExec = jest.fn().mockResolvedValue(existingUser);
    const findOne = jest.fn().mockReturnValue({ exec: findOneExec });

    const usersService = new UsersService(
      { findOne, create } as never,
      mockConfigService,
    );

    const seeded = await usersService.ensureSuperAdmin();

    expect(seeded).toBe(existingUser);
    expect(create).not.toHaveBeenCalled();
    expect(existingUser.save).not.toHaveBeenCalled();
  });

  it('upgrades an existing matching user to SUPER_ADMIN when needed', async () => {
    const existingUser = {
      id: 'existing-id',
      name: 'Rico',
      email: 'rico@admin.com',
      role: UserRole.ADMIN,
      is_active: false,
      save: jest.fn().mockResolvedValue(undefined),
    };

    const create = jest.fn();
    const findOneExec = jest.fn().mockResolvedValue(existingUser);
    const findOne = jest.fn().mockReturnValue({ exec: findOneExec });

    const usersService = new UsersService(
      { findOne, create } as never,
      mockConfigService,
    );

    const seeded = await usersService.ensureSuperAdmin();

    expect(seeded).toBe(existingUser);
    expect(existingUser.role).toBe(UserRole.SUPER_ADMIN);
    expect(existingUser.is_active).toBe(true);
    expect(existingUser.save).toHaveBeenCalledTimes(1);
    expect(create).not.toHaveBeenCalled();
  });

  it('creates super admin when it does not exist', async () => {
    const createdUser = { id: 'new-id', email: 'rico@admin.com' };
    const create = jest.fn().mockResolvedValue(createdUser);
    const findOneExec = jest.fn().mockResolvedValue(null);
    const findOne = jest.fn().mockReturnValue({ exec: findOneExec });

    const usersService = new UsersService(
      { findOne, create } as never,
      mockConfigService,
    );

    const seeded = await usersService.ensureSuperAdmin();

    expect(seeded).toBe(createdUser);
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        role: UserRole.SUPER_ADMIN,
        email: 'rico@admin.com',
      }),
    );
  });
});
