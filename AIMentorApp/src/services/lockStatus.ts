// Shared bridge between ScreenLayout (which knows if a student is currently
// locked out by parental controls) and App.tsx's IdleTimeoutGuard (which lives
// above ScreenLayout in the tree and has no other way to know). Without this,
// the "Are you still there?" idle-logout modal could appear stacked on top of
// a parental-control lock screen, which makes no sense to show together.
let locked = false;
const listeners = new Set<(v: boolean) => void>();

export function setStudentLocked(v: boolean) {
  if (locked === v) return;
  locked = v;
  listeners.forEach(fn => fn(v));
}

export function isStudentLocked() {
  return locked;
}

export function subscribeStudentLocked(fn: (v: boolean) => void) {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}
