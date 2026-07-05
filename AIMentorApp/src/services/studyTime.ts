// Caps any single question's tracked time before summing, so a question left
// open/backgrounded for a long stretch (tab idle, device asleep, browser left
// open overnight) can't leak hours of wall-clock idle time into recorded
// study time. Used by IBPYPQuizScreen when a quiz finishes.
export const PER_QUESTION_CAP_SECONDS = 180;

export function computeCappedQuizMinutes(
  perQuestionResults: { timeSeconds?: number }[],
  capSeconds: number = PER_QUESTION_CAP_SECONDS
): number {
  const activeSeconds = perQuestionResults.reduce(
    (sum, r) => sum + Math.min(r.timeSeconds || 0, capSeconds),
    0
  );
  return Math.round(activeSeconds / 60);
}
