import SERVER_URL from '../../../config/serverUrl';
import { Announcement } from '../types/announcement.types';

export interface InboxPage {
  items: Announcement[];
  total: number;
  page: number;
  limit: number;
}

export async function fetchActiveAnnouncements(userEmail: string, surface: 'banner' | 'inbox'): Promise<Announcement[]> {
  const res = await fetch(
    `${SERVER_URL}/announcements/active?userEmail=${encodeURIComponent(userEmail)}&surface=${surface}`
  );
  if (!res.ok) throw new Error(`active fetch failed: ${res.status}`);
  const data = await res.json();
  return Array.isArray(data) ? data : [];
}

export async function fetchInbox(userEmail: string, opts?: { page?: number; limit?: number }): Promise<InboxPage> {
  const page = opts?.page ?? 1;
  const limit = opts?.limit ?? 50;
  const res = await fetch(
    `${SERVER_URL}/announcements?userEmail=${encodeURIComponent(userEmail)}&page=${page}&limit=${limit}`
  );
  if (!res.ok) throw new Error(`inbox fetch failed: ${res.status}`);
  return res.json();
}

export async function markSeen(id: string, userEmail: string): Promise<void> {
  await fetch(`${SERVER_URL}/announcements/${id}/seen`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ userEmail }),
  });
}

export async function dismissAnnouncement(id: string, userEmail: string): Promise<void> {
  await fetch(`${SERVER_URL}/announcements/${id}/dismiss`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ userEmail }),
  });
}

// ── Admin API ────────────────────────────────────────────────────────────────

export interface AnnouncementDraft {
  title: string;
  body: string;
  severity: string;
  displayType: string;
  status?: string;
  startsAt?: string | null;
  expiresAt?: string | null;
  targets?: { schoolId?: string | null; role?: string | null }[];
  attachments?: { url: string; name: string; type: string; size: number }[];
}

async function adminRequest(pathname: string, method: string, adminEmail: string, payload?: object) {
  const res = await fetch(`${SERVER_URL}/announcements/admin${pathname}`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ adminEmail, ...(payload || {}) }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error || `Request failed (${res.status})`);
  return data;
}

export async function adminListAnnouncements(adminEmail: string): Promise<Announcement[]> {
  const res = await fetch(`${SERVER_URL}/announcements/admin/all?adminEmail=${encodeURIComponent(adminEmail)}`);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error || `Request failed (${res.status})`);
  return Array.isArray(data) ? data : [];
}

export async function adminListSchools(adminEmail: string): Promise<{ id: string; name: string }[]> {
  const res = await fetch(`${SERVER_URL}/announcements/admin/schools?adminEmail=${encodeURIComponent(adminEmail)}`);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error || `Request failed (${res.status})`);
  return Array.isArray(data) ? data : [];
}

export function adminCreateAnnouncement(adminEmail: string, draft: AnnouncementDraft): Promise<Announcement> {
  return adminRequest('', 'POST', adminEmail, draft);
}

export function adminDraftAnnouncement(adminEmail: string, prompt: string): Promise<{ title: string; body: string }> {
  return adminRequest('/ai-draft', 'POST', adminEmail, { prompt });
}

export function adminUpdateAnnouncement(adminEmail: string, id: string, draft: Partial<AnnouncementDraft> & { bumpVersion?: boolean }): Promise<Announcement> {
  return adminRequest(`/${id}`, 'PATCH', adminEmail, draft);
}

export function adminPublishAnnouncement(adminEmail: string, id: string): Promise<Announcement> {
  return adminRequest(`/${id}/publish`, 'POST', adminEmail);
}

export function adminArchiveAnnouncement(adminEmail: string, id: string): Promise<Announcement> {
  return adminRequest(`/${id}/archive`, 'POST', adminEmail);
}

export async function adminUploadAttachment(adminEmail: string, file: File): Promise<{ url: string; name: string; type: string; size: number }> {
  const form = new FormData();
  form.append('file', file);
  const res = await fetch(`${SERVER_URL}/announcements/admin/upload?adminEmail=${encodeURIComponent(adminEmail)}`, {
    method: 'POST',
    body: form,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error || 'Upload failed');
  return data;
}
