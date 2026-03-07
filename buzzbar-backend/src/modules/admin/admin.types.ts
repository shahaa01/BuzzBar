export type AdminRole = 'superadmin' | 'admin' | 'employee';

export type AdminPublic = {
  id: string;
  email: string;
  role: AdminRole;
  isActive: boolean;
};

