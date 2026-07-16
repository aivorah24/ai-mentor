/** Single source of truth for user-facing role labels — raw `role` values
 * (school_admin, super_admin, ...) are database identifiers, never copy. */
export const ROLE_LABEL: Record<string, string> = {
  student: 'Student',
  parent: 'Parent',
  teacher: 'Teacher',
  school_admin: 'School Administrator',
  super_admin: 'Platform Administrator',
};

export function roleLabel(role?: string | null): string {
  if (!role) return '';
  return ROLE_LABEL[role] || role;
}
