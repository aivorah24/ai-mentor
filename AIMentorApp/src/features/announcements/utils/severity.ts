/**
 * Single source of truth for mapping the backend's severity values
 * (info/warning/critical — see server/sql/announcements.sql check constraint)
 * to user-facing labels, theme color tokens, and icons. Every component that
 * shows severity (banner, list rows, filter chips, detail badge) reads from
 * here instead of hardcoding its own copy or colors.
 */
import type { AppColors } from '../../../theme';
import type { Announcement } from '../types/announcement.types';

export const SEVERITY_ORDER: Announcement['severity'][] = ['critical', 'warning', 'info'];

export const SEVERITY_LABEL: Record<Announcement['severity'], string> = {
  critical: 'Urgent',
  warning: 'Important',
  info: 'Notice',
};

export const SEVERITY_ICON: Record<Announcement['severity'], string> = {
  critical: 'alert-octagon',
  warning: 'alert-triangle',
  info: 'info',
};

// Reuses the app's existing semantic-ish accent tokens rather than inventing
// a new palette — accentRed/accentOrange are already the app's "alert" colors,
// primary (sage) is already used for neutral/informational state elsewhere.
export function severityColor(colors: AppColors, severity: Announcement['severity']): string {
  if (severity === 'critical') return colors.accentRed;
  if (severity === 'warning') return colors.accentOrange;
  return colors.primary;
}
