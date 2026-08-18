import { UserRole } from '../enums/user-role.enum';

/**
 * Server-derived actor context. Controllers must never accept organization_id from DTOs.
 */
export type AuthActor = {
  user_id: string;
  organization_id: string;
  role: UserRole;
  email: string;
  name: string;
};
