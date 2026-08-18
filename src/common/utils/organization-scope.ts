import { UnauthorizedException } from '@nestjs/common';
import { Types } from 'mongoose';
import type { AuthActor } from '../types/auth-actor';
import { asObjectId } from './object-id';

/**
 * Every live company-owned query must include organization scope.
 */
export function withOrganizationScope<T extends Record<string, unknown>>(
  organizationId: string | Types.ObjectId,
  query: T = {} as T,
): T & { organization_id: Types.ObjectId } {
  const organization_id =
    organizationId instanceof Types.ObjectId
      ? organizationId
      : asObjectId(String(organizationId), 'organization id');

  return {
    ...query,
    organization_id,
  };
}

/**
 * Defense-in-depth: reject any request-supplied organization id that differs
 * from the authenticated actor's fixed company ownership. Controllers must
 * still derive scope from `@CurrentActor()` only.
 */
export function assertActorOrganization(
  actor: AuthActor,
  requestedOrganizationId: string | null | undefined,
): void {
  if (
    requestedOrganizationId &&
    requestedOrganizationId !== actor.organization_id
  ) {
    throw new UnauthorizedException(
      'Request organization scope cannot override actor company ownership',
    );
  }
}

export function readRequestOrganizationId(source: unknown): string | undefined {
  if (!source || typeof source !== 'object') {
    return undefined;
  }

  const value = (source as Record<string, unknown>).organization_id;
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}
