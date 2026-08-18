import { ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { UserRole } from '../common/enums/user-role.enum';
import { RolesGuard } from '../auth/guards/roles.guard';
import { ClientsController } from './clients.controller';
import type { ExecutionContext } from '@nestjs/common';

type RequestShape = {
  actor?: {
    role: UserRole;
  };
};

function getHandler(name: keyof ClientsController) {
  const descriptor = Object.getOwnPropertyDescriptor(
    ClientsController.prototype,
    name,
  );
  if (!descriptor || typeof descriptor.value !== 'function') {
    throw new Error(`ClientsController.${String(name)} is unavailable`);
  }
  return descriptor.value as (...args: never[]) => unknown;
}

function createContext(
  request: RequestShape,
  handler: (...args: never[]) => unknown,
): ExecutionContext {
  return {
    getHandler: () => handler,
    getClass: () => ClientsController,
    switchToHttp: () => ({
      getRequest: () => request,
    }),
  } as unknown as ExecutionContext;
}

describe('ClientsController role grants', () => {
  const rolesGuard = new RolesGuard(new Reflector());

  it('allows TECHNICIAN to create clients', () => {
    expect(
      rolesGuard.canActivate(
        createContext(
          { actor: { role: UserRole.TECHNICIAN } },
          getHandler('create'),
        ),
      ),
    ).toBe(true);
  });

  it('allows TECHNICIAN to archive clients', () => {
    expect(
      rolesGuard.canActivate(
        createContext(
          { actor: { role: UserRole.TECHNICIAN } },
          getHandler('archive'),
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
