import AsyncStorage from '@react-native-async-storage/async-storage';
import SERVER_URL from '../config/serverUrl';

// Warms the Dashboard's curriculum data the MOMENT a student's session is
// resolved (login, or a persisted session restored on app open) — instead of
// waiting until they actually navigate to Dashboard and trigger the fetch
// there. Without this, every dashboard visit shows a "Loading your
// dashboard" spinner even though the data rarely changes, which reads as
// broken/slow rather than seamless.
//
// Populates BOTH an in-memory cache (read synchronously by DashboardScreen
// on mount — zero-latency, no spinner) and AsyncStorage (the same keys/shape
// DashboardScreen already reads, so nothing else about its caching changes).

export type CachedCurriculum = { data: any; ts: number; type: 'ibpyp' | 'ncert' };
export type CachedSubjectChapters = { subject: string; chapters: string[] }[];

const memCurriculum = new Map<string, CachedCurriculum>();
const memSubjects = new Map<string, CachedSubjectChapters>();

export function curriculumCacheKey(isIBPYP: boolean, grade: string): string {
  return `dashboard_curriculum_${isIBPYP ? 'ibpyp' : 'ncert'}_${grade}_v1`;
}

export function getMemoryCurriculum(key: string): CachedCurriculum | undefined {
  return memCurriculum.get(key);
}

export function getMemorySubjectChapters(key: string): CachedSubjectChapters | undefined {
  return memSubjects.get(key);
}

const NO_CONTENT_GRADES = ['Nursery', 'LKG', 'UKG'];

// Fire-and-forget — callers must NOT await this on the auth-resolution path,
// it should never delay login.
export async function prefetchStudentDashboard(user: { role?: string; grade?: string; curriculum?: string }): Promise<void> {
  try {
    if (user.role !== 'student') return;
    const studentGrade = user.grade || 'Grade 3';
    if (NO_CONTENT_GRADES.includes(studentGrade)) return;
    const isIBPYP = !user.curriculum || user.curriculum.toLowerCase().includes('ib');
    const isGrade3 = studentGrade === 'Grade 3' || studentGrade === 'Class 3';
    const useUnified = isIBPYP || !isGrade3;
    const cacheKey = curriculumCacheKey(isIBPYP, studentGrade);

    let data: any;
    let type: 'ibpyp' | 'ncert';
    if (useUnified) {
      const curricParam = encodeURIComponent(isIBPYP ? 'IB_PYP' : (user.curriculum ?? 'NCERT'));
      const gradeParam = encodeURIComponent(studentGrade);
      const res = await fetch(`${SERVER_URL}/curriculum?curriculum=${curricParam}&grade=${gradeParam}`);
      if (!res.ok) return;
      data = await res.json();
      type = 'ibpyp';

      // Real chapter/unit names per subject — same authoritative source the
      // Performance bars use (see DashboardScreen's subjectChapters fetch).
      fetch(`${SERVER_URL}/curriculum/subjects?grade=${gradeParam}&curriculum=${curricParam}`)
        .then(r => r.json())
        .then(d => {
          if (!Array.isArray(d.subjects)) return;
          memSubjects.set(cacheKey, d.subjects.map((s: any) => ({
            subject: s.subject,
            chapters: (s.chapters?.length ? s.chapters.map((c: any) => c.title) : s.units) || [],
          })));
        })
        .catch(() => {});
    } else {
      const res = await fetch(`${SERVER_URL}/ncert/chapters`);
      if (!res.ok) return;
      data = await res.json();
      type = 'ncert';
    }

    const ts = Date.now();
    memCurriculum.set(cacheKey, { data, ts, type });
    await AsyncStorage.setItem(cacheKey, JSON.stringify({ data, ts, type })).catch(() => {});
  } catch {
    // Best-effort — DashboardScreen falls back to its own fetch if this failed.
  }
}
