import SERVER_URL from '../../../config/serverUrl';

export interface MyClass {
  grade: string;
  section: string;
  label: string;
  code: string;
  classTeacherEmail: string | null;
  classTeacherName: string | null;
  studentCount: number;
  studentId?: string;
  studentName?: string;
}

export async function fetchMyClasses(email: string): Promise<MyClass[]> {
  const res = await fetch(`${SERVER_URL}/classes/mine?email=${encodeURIComponent(email)}`);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error || `Request failed (${res.status})`);
  return Array.isArray(data?.classes) ? data.classes : [];
}
