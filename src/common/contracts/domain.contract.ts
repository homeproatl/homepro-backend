import { UserRole } from '../enums/user-role.enum';

export type UserContract = {
  id: string;
  name: string;
  email: string;
  phone?: string | null;
  role: UserRole;
  is_active?: boolean;
  created_by?: string | null;
  created_at?: string;
  updated_at?: string;
};
