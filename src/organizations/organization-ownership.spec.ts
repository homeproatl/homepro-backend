import { UnauthorizedException } from '@nestjs/common';
import { Types } from 'mongoose';
import { UserRole } from '../common/enums/user-role.enum';
import {
  assertActorOrganization,
  withOrganizationScope,
} from '../common/utils/organization-scope';
import type { AuthActor } from '../common/types/auth-actor';

describe('organization ownership scope (P02-09)', () => {
  const companyA = new Types.ObjectId().toHexString();
  const companyB = new Types.ObjectId().toHexString();

  const actor: AuthActor = {
    user_id: new Types.ObjectId().toHexString(),
    organization_id: companyA,
    role: UserRole.ADMIN,
    email: 'owner@example.com',
    name: 'Owner',
  };

  it('always stamps organization_id from actor scope into queries', () => {
    const scoped = withOrganizationScope(actor.organization_id, {
      _id: new Types.ObjectId(companyB),
    });
    expect(String(scoped.organization_id)).toBe(companyA);
    expect(String(scoped._id)).toBe(companyB);
  });

  it('rejects request-supplied organization ids that differ from actor scope', () => {
    expect(() => assertActorOrganization(actor, companyB)).toThrow(
      UnauthorizedException,
    );
  });

  it('allows matching or omitted request organization ids', () => {
    expect(() => assertActorOrganization(actor, companyA)).not.toThrow();
    expect(() => assertActorOrganization(actor, undefined)).not.toThrow();
    expect(() => assertActorOrganization(actor, null)).not.toThrow();
  });
});
