import SERVER_URL from '../../../config/serverUrl';

export interface Channel {
  id: string; name: string; category: 'class' | 'public' | 'staff';
  iconLabel: string; grade: string | null; section: string | null;
  posting: 'members' | 'staff_only';
  memberCount: number; unread: number;
  lastMessage: { body: string; at: string } | null;
  canPost: boolean; postingNote: string | null; isManager: boolean;
}
export interface ChannelMessage {
  id: string; body: string; at: string; senderEmail: string; senderName: string; mine: boolean;
}
export interface ChannelMember {
  email: string; name: string; roleLabel: string | null; isManager: boolean; you: boolean;
}

export async function fetchChannels(email: string): Promise<Channel[]> {
  const res = await fetch(`${SERVER_URL}/channels?email=${encodeURIComponent(email)}`);
  if (!res.ok) throw new Error('Failed to load channels');
  return res.json();
}

export async function fetchChannelMessages(email: string, id: string): Promise<{ channel: any; canPost: boolean; messages: ChannelMessage[] }> {
  const res = await fetch(`${SERVER_URL}/channels/${id}/messages?email=${encodeURIComponent(email)}`);
  if (!res.ok) throw new Error((await res.json().catch(() => ({})))?.error || 'Failed to load messages');
  return res.json();
}

export async function sendChannelMessage(email: string, id: string, body: string): Promise<void> {
  const res = await fetch(`${SERVER_URL}/channels/${id}/messages`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, body }),
  });
  if (!res.ok) throw new Error((await res.json().catch(() => ({})))?.error || 'Failed to send');
}

export async function fetchChannelMembers(email: string, id: string): Promise<ChannelMember[]> {
  const res = await fetch(`${SERVER_URL}/channels/${id}/members?email=${encodeURIComponent(email)}`);
  if (!res.ok) throw new Error('Failed to load members');
  return res.json();
}

export async function markChannelRead(email: string, id: string): Promise<void> {
  await fetch(`${SERVER_URL}/channels/${id}/read`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email }),
  }).catch(() => {});
}

export async function createChannel(body: {
  email: string; name: string; category?: string; grade?: string; section?: string;
  posting?: string; iconLabel?: string; memberEmails?: string[];
  members?: { email: string; roleLabel: string }[];
  autoAddParentsOfGrade?: string; autoAddParentsOfSection?: string; studentIds?: string[];
  autoAddAllStaff?: boolean;
}): Promise<{ id: string; memberCount: number }> {
  const res = await fetch(`${SERVER_URL}/channels`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error((await res.json().catch(() => ({})))?.error || 'Failed to create channel');
  return res.json();
}

export interface GradeSections { name: string; sections: string[]; }
export interface Homeroom { grade: string; section: string; }

export async function fetchGradesSections(email: string): Promise<{ grades: GradeSections[]; myHomerooms: Homeroom[] }> {
  const res = await fetch(`${SERVER_URL}/channels/grades-sections?email=${encodeURIComponent(email)}`);
  if (!res.ok) throw new Error('Failed to load grades');
  const data = await res.json();
  return { grades: data.grades, myHomerooms: data.myHomerooms || [] };
}

export interface MyStudent { id: string; name: string; grade: string | null; section: string | null; }

export async function fetchMyStudents(email: string): Promise<MyStudent[]> {
  const res = await fetch(`${SERVER_URL}/channels/my-students?email=${encodeURIComponent(email)}`);
  if (!res.ok) throw new Error('Failed to load students');
  return res.json();
}

export interface Person { email: string; name: string; roleLabel: string; }

// WhatsApp-style combined search: students + their parents, optionally
// narrowed to a grade/section, for the "Create group" people picker.
export async function searchPeople(email: string, opts: { grade?: string; section?: string; q?: string }): Promise<Person[]> {
  const params = new URLSearchParams({ email });
  if (opts.grade) params.set('grade', opts.grade);
  if (opts.section) params.set('section', opts.section);
  if (opts.q) params.set('q', opts.q);
  const res = await fetch(`${SERVER_URL}/channels/people?${params.toString()}`);
  if (!res.ok) throw new Error('Failed to search people');
  return res.json();
}

export async function createFamilyChannel(email: string, studentId: string): Promise<{ id: string; memberCount: number; reused?: boolean }> {
  const res = await fetch(`${SERVER_URL}/channels/family`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, studentId }),
  });
  if (!res.ok) throw new Error((await res.json().catch(() => ({})))?.error || 'Failed to create family room');
  return res.json();
}

export async function addChannelMembers(email: string, id: string, addEmails: string[], roleLabel?: string): Promise<{ added: number }> {
  const res = await fetch(`${SERVER_URL}/channels/${id}/members`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, addEmails, roleLabel }),
  });
  if (!res.ok) throw new Error((await res.json().catch(() => ({})))?.error || 'Failed to add members');
  return res.json();
}

// ISO → "3:04 PM" or "Mon" or "12 Jul"
export function fmtChannelTime(iso: string): string {
  if (!iso) return '';
  const d = new Date(iso); const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  if (sameDay) { let h = d.getHours(); const m = String(d.getMinutes()).padStart(2, '0'); const ap = h >= 12 ? 'PM' : 'AM'; h = h % 12 || 12; return `${h}:${m} ${ap}`; }
  const diff = (now.getTime() - d.getTime()) / 86400000;
  if (diff < 7) return ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'][d.getDay()];
  return `${d.getDate()} ${['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][d.getMonth()]}`;
}
