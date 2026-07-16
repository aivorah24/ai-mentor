import SERVER_URL from '../../../config/serverUrl';

export interface PortfolioAttachment {
  url: string;
  type: 'image' | 'video';
  name: string | null;
  size: number | null;
}

export interface PortfolioTag {
  studentId: string;
  studentName: string | null;
}

export interface PortfolioPost {
  id: string;
  grade: string;
  section: string;
  caption: string;
  status: 'draft' | 'published' | 'archived';
  createdBy: string;
  createdByName: string | null;
  createdAt: string;
  attachments: PortfolioAttachment[];
  tags: PortfolioTag[];
  likeCount: number;
  isLiked: boolean;
  commentCount: number;
}

export interface PortfolioComment {
  id: string;
  body: string;
  createdAt: string;
  userId: string;
  userName: string | null;
}

export async function fetchPosts(grade: string, section: string, userEmail: string): Promise<PortfolioPost[]> {
  const res = await fetch(
    `${SERVER_URL}/class-portfolio/posts?grade=${encodeURIComponent(grade)}&section=${encodeURIComponent(section || '')}&userEmail=${encodeURIComponent(userEmail)}`
  );
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error || `Request failed (${res.status})`);
  return Array.isArray(data?.posts) ? data.posts : [];
}

export interface PostDraft {
  teacherEmail: string;
  grade: string;
  section: string;
  caption: string;
  status?: 'draft' | 'published';
  attachments?: { url: string; type: string; name: string; size: number }[];
  studentIds?: string[];
}

export async function createPost(draft: PostDraft): Promise<PortfolioPost> {
  const res = await fetch(`${SERVER_URL}/class-portfolio/posts`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(draft),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error || `Request failed (${res.status})`);
  return data;
}

export async function publishPost(postId: string, teacherEmail: string): Promise<{ ok: boolean }> {
  const res = await fetch(`${SERVER_URL}/class-portfolio/posts/${postId}/publish`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ teacherEmail }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error || `Request failed (${res.status})`);
  return data;
}
export async function deletePost(postId: string, teacherEmail: string): Promise<{ ok: boolean }> {
  const res = await fetch(`${SERVER_URL}/class-portfolio/posts/${postId}`, {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ teacherEmail }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error || `Request failed (${res.status})`);
  return data;
}
export async function toggleLike(postId: string, userEmail: string): Promise<{ liked: boolean }> {
  const res = await fetch(`${SERVER_URL}/class-portfolio/posts/${postId}/like`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ userEmail }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error || `Request failed (${res.status})`);
  return data;
}

export async function fetchComments(postId: string): Promise<PortfolioComment[]> {
  const res = await fetch(`${SERVER_URL}/class-portfolio/posts/${postId}/comments`);
  const data = await res.json().catch(() => ([]));
  if (!res.ok) throw new Error((data as any)?.error || `Request failed (${res.status})`);
  return Array.isArray(data) ? data : [];
}

export async function addComment(postId: string, userEmail: string, body: string): Promise<PortfolioComment> {
  const res = await fetch(`${SERVER_URL}/class-portfolio/posts/${postId}/comments`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ userEmail, body }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error || `Request failed (${res.status})`);
  return data;
}

export async function uploadAttachment(file: File): Promise<{ url: string; name: string; size: number; type: string }> {
  const form = new FormData();
  form.append('file', file);
  const res = await fetch(`${SERVER_URL}/class-portfolio/upload`, { method: 'POST', body: form });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error || 'Upload failed');
  return data;
}

export interface PortfolioFolder {
  id: string;
  name: string;
  color: string;
  createdBy: string;
  createdAt: string;
}

export async function fetchFolders(grade: string, section: string, userEmail: string): Promise<PortfolioFolder[]> {
  const res = await fetch(
    `${SERVER_URL}/class-portfolio/folders?grade=${encodeURIComponent(grade)}&section=${encodeURIComponent(section || '')}&userEmail=${encodeURIComponent(userEmail)}`
  );
  const data = await res.json().catch(() => ([]));
  if (!res.ok) throw new Error(data?.error || `Request failed (${res.status})`);
  return Array.isArray(data) ? data : [];
}

export async function createFolder(teacherEmail: string, grade: string, section: string, name: string, color?: string): Promise<PortfolioFolder> {
  const res = await fetch(`${SERVER_URL}/class-portfolio/folders`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ teacherEmail, grade, section, name, color }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error || `Request failed (${res.status})`);
  return data;
}

export async function renameFolder(folderId: string, teacherEmail: string, name: string): Promise<PortfolioFolder> {
  const res = await fetch(`${SERVER_URL}/class-portfolio/folders/${folderId}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ teacherEmail, name }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error || `Request failed (${res.status})`);
  return data;
}

export async function deleteFolder(folderId: string, teacherEmail: string): Promise<{ ok: boolean }> {
  const res = await fetch(`${SERVER_URL}/class-portfolio/folders/${folderId}`, {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ teacherEmail }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error || `Request failed (${res.status})`);
  return data;
}
