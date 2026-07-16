/**
 * Single source of truth for turning the backend's normalized audience
 * metadata (audienceRoles + audienceSchoolName, empty = everyone) into a
 * user-facing label. Derived from real target data — never hardcoded.
 */
import { Announcement } from '../types/announcement.types';

const ROLE_LABEL: Record<string, string> = {
  parent: 'Parents',
  student: 'Students',
  teacher: 'Teachers',
  school_admin: 'Admins',
};

export function audienceLabel(a: Pick<Announcement, 'audienceRoles' | 'audienceSchoolName'>): string {
  const roles = (a.audienceRoles || []).map((r) => ROLE_LABEL[r] || r);
  const rolePart = roles.length ? roles.join(' & ') : '';
  if (a.audienceSchoolName && rolePart) return `${rolePart} · ${a.audienceSchoolName}`;
  if (a.audienceSchoolName) return a.audienceSchoolName;
  if (rolePart) return `All ${rolePart}`;
  return 'Everyone';
}
