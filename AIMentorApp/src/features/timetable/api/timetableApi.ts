import SERVER_URL from '../../../config/serverUrl';

export interface PeriodDef {
  code: string;      // 'P0', 'P1', 'BRK', 'LUNCH', ...
  start: string;     // '08:25'
  end: string;       // '08:50'
  isBreak: boolean;
}

export interface TimetableSlot {
  id: string;
  day: string;       // 'MON'..'SAT'
  periodCode: string;
  subject: string | null;
  room: string | null;
  teacherId: string | null;
  teacherName: string | null;
  materialUrl: string | null;
  materialName: string | null;
  color: string | null;
}

export interface Timetable {
  grade: string;
  section: string;
  title: string;
  periodDefs: PeriodDef[];
  days: string[];
  slots: TimetableSlot[];
  permissions: { canManageTemplate: boolean; canEditSlot: boolean };
}

export async function fetchTimetable(email: string, schoolId: string, grade: string, section: string): Promise<Timetable> {
  const q = new URLSearchParams({ email, schoolId, grade, section: section || '' });
  const res = await fetch(`${SERVER_URL}/timetable?${q}`);
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data?.error || 'Failed to load timetable');
  }
  return res.json();
}

export async function saveTemplate(body: {
  email: string; schoolId: string; grade: string; section: string; title?: string; periodDefs: PeriodDef[];
}): Promise<void> {
  const res = await fetch(`${SERVER_URL}/timetable/template`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data?.error || 'Failed to save the bell schedule');
  }
}

export async function saveSlot(body: {
  email: string; schoolId: string; grade: string; section: string;
  day: string; periodCode: string;
  subject?: string; room?: string; teacherId?: string | null;
  materialUrl?: string | null; materialName?: string | null; color?: string | null;
}): Promise<void> {
  const res = await fetch(`${SERVER_URL}/timetable/slot`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data?.error || 'Failed to save the slot');
  }
}

// 'HH:MM' (24h) → '8:25 am' style used in the cards/popup.
export function fmtTime(hhmm: string): string {
  if (!hhmm || !/^\d{1,2}:\d{2}$/.test(hhmm)) return hhmm || '';
  const [h, m] = hhmm.split(':').map(Number);
  const ampm = h >= 12 ? 'pm' : 'am';
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${String(m).padStart(2, '0')} ${ampm}`;
}

export const DAY_LABELS: Record<string, string> = {
  MON: 'Mon', TUE: 'Tue', WED: 'Wed', THU: 'Thu', FRI: 'Fri', SAT: 'Sat',
};

// Stable pastel fill per subject (Toddle-style). Deterministic hash → palette,
// so the same subject always gets the same colour across the grid.
export const SUBJECT_PALETTE = ['#E0F7FA', '#E8E4F5', '#FCE4EC', '#FFF9C4', '#E8F5E9', '#FFF3E0', '#E3F2FD', '#F3E5F5'];
export function subjectColor(subject: string | null): string {
  if (!subject) return 'transparent';
  let h = 0;
  for (let i = 0; i < subject.length; i++) h = (h * 31 + subject.charCodeAt(i)) >>> 0;
  return SUBJECT_PALETTE[h % SUBJECT_PALETTE.length];
}
