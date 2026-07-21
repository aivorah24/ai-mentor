import SERVER_URL from '../../../config/serverUrl';

export interface ResourceFolder {
  id: string; name: string; scope: string; author: string; updatedAt: string;
}
export interface ResourceFile {
  id: string; title: string; fileUrl: string; fileType: string | null;
  fileSize: number; scope: string; author: string; updatedAt: string;
}
export interface ResourcesResponse {
  canManage: boolean;
  scopeLabel: string | null;
  breadcrumb: { id: string; name: string }[];
  folders: ResourceFolder[];
  files: ResourceFile[];
}

export async function fetchResources(email: string, folderId?: string | null): Promise<ResourcesResponse> {
  const q = new URLSearchParams({ email });
  if (folderId) q.set('folderId', folderId);
  const res = await fetch(`${SERVER_URL}/resources?${q}`);
  if (!res.ok) {
    const d = await res.json().catch(() => ({}));
    throw new Error(d?.error || 'Failed to load resources');
  }
  return res.json();
}

export async function createFolder(body: { email: string; name: string; parentFolderId?: string | null; scope?: string }) {
  const res = await fetch(`${SERVER_URL}/resources/folder`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error((await res.json().catch(() => ({})))?.error || 'Failed to create folder');
}

export async function addFile(body: { email: string; folderId?: string | null; title: string; fileUrl: string; fileType?: string; fileSize?: number; scope?: string }) {
  const res = await fetch(`${SERVER_URL}/resources/file`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error((await res.json().catch(() => ({})))?.error || 'Failed to add file');
}

export async function deleteFolder(email: string, id: string) {
  const res = await fetch(`${SERVER_URL}/resources/folder/${id}`, {
    method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email }),
  });
  if (!res.ok) throw new Error((await res.json().catch(() => ({})))?.error || 'Failed to delete folder');
}

export async function deleteFile(email: string, id: string) {
  const res = await fetch(`${SERVER_URL}/resources/file/${id}`, {
    method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email }),
  });
  if (!res.ok) throw new Error((await res.json().catch(() => ({})))?.error || 'Failed to delete file');
}

// bytes → "13.55 MB" / "820 KB"
export function fmtSize(bytes: number): string {
  if (!bytes) return '—';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

// ISO → "16 Jul 2026, 7:04 PM"
export function fmtWhen(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  const day = d.getDate();
  const mon = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][d.getMonth()];
  let h = d.getHours(); const m = String(d.getMinutes()).padStart(2, '0');
  const ampm = h >= 12 ? 'PM' : 'AM'; h = h % 12 || 12;
  return `${day} ${mon} ${d.getFullYear()}, ${h}:${m} ${ampm}`;
}
