import { Reflector } from '@nestjs/core';
import { RolesGuard } from '../auth/guards/roles.guard';
import { ROLES_KEY } from '../auth/decorators/roles.decorator';
import { UserRole } from '../common/enums/user-role.enum';
import { UsersController } from './users.controller';

describe('UsersController roles', () => {
  it('restricts the users management API to admins', () => {
    const roles = Reflect.getMetadata(ROLES_KEY, UsersController);

    expect(roles).toEqual([UserRole.ADMIN]);
  });

  it('blocks technicians from users management handlers', () => {
    const guard = new RolesGuard(new Reflector());
    const context = {
      getHandler: () => UsersController.prototype.getUsers,
      getClass: () => UsersController,
      switchToHttp: () => ({
        getRequest: () => ({ user: { role: UserRole.TECHNICIAN } }),
      }),
    } as never;

    expect(() => guard.canActivate(context)).toThrow('Insufficient role');
  });
});
