import { ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { ExecutionContext } from '@nestjs/common';
import { UserRole } from '../common/enums/user-role.enum';
import { RolesGuard } from '../auth/guards/roles.guard';
import { ItemsController } from './items.controller';

type RequestShape = {
  actor?: {
    role: UserRole;
  };
};

function getHandler(name: keyof ItemsController) {
  const descriptor = Object.getOwnPropertyDescriptor(
    ItemsController.prototype,
    name,
  );
  if (!descriptor || typeof descriptor.value !== 'function') {
    throw new Error(`ItemsController.${String(name)} is unavailable`);
  }
  return descriptor.value as (...args: never[]) => unknown;
}

function createContext(
  request: RequestShape,
  handler: (...args: never[]) => unknown,
): ExecutionContext {
  return {
    getHandler: () => handler,
    getClass: () => ItemsController,
    switchToHttp: () => ({
      getRequest: () => request,
    }),
  } as unknown as ExecutionContext;
}

describe('ItemsController role grants', () => {
  const rolesGuard = new RolesGuard(new Reflector());

  it('allows TECHNICIAN to create and deactivate items', () => {
    expect(
      rolesGuard.canActivate(
        createContext(
          { actor: { role: UserRole.TECHNICIAN } },
          getHandler('create'),
        ),
      ),
    ).toBe(true);
    expect(
      rolesGuard.canActivate(
        createContext(
          { actor: { role: UserRole.TECHNICIAN } },
          getHandler('deactivate'),
        ),
      ),
    ).toBe(true);
  });

  it('denies TECHNICIAN hard delete', () => {
    expect(() =>
      rolesGuard.canActivate(
        createContext(
          { actor: { role: UserRole.TECHNICIAN } },
          getHandler('remove'),
        ),
      ),
    ).toThrow(ForbiddenException);
  });

  it('allows ADMIN hard delete', () => {
    expect(
      rolesGuard.canActivate(
        createContext(
          { actor: { role: UserRole.ADMIN } },
          getHandler('remove'),
        ),
      ),
    ).toBe(true);
  });
});
