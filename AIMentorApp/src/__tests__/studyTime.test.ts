/**
 * Regression test for the "7h study time" bug: a quiz question left open in
 * a backgrounded/idle browser tab for hours must not leak that wall-clock
 * gap into recorded study time. computeCappedQuizMinutes caps each
 * question's tracked time before summing.
 */
import { computeCappedQuizMinutes, PER_QUESTION_CAP_SECONDS } from '../services/studyTime';

describe('computeCappedQuizMinutes', () => {
  it('sums normal per-question times as-is', () => {
    const results = [{ timeSeconds: 30 }, { timeSeconds: 45 }, { timeSeconds: 20 }];
    // 95s total → 1.58min → rounds to 2
    expect(computeCappedQuizMinutes(results)).toBe(2);
  });

  it('caps a single runaway question (e.g. tab left idle for 7 hours)', () => {
    const results = [
      { timeSeconds: 25200 }, // 7 hours — the exact bug scenario reported
      { timeSeconds: 20 },
      { timeSeconds: 25 },
    ];
    const minutes = computeCappedQuizMinutes(results);
    // Must be bounded by the cap, not the raw 7-hour value (420 minutes)
    expect(minutes).toBeLessThan(10);
    expect(minutes).toBe(Math.round((PER_QUESTION_CAP_SECONDS + 20 + 25) / 60));
  });

  it('caps every question when a whole quiz sits idle overnight', () => {
    const results = Array.from({ length: 5 }, () => ({ timeSeconds: 999999 }));
    const minutes = computeCappedQuizMinutes(results);
    // Worst case: 5 questions * 180s cap = 900s = 15 minutes, never hours
    expect(minutes).toBe(Math.round((5 * PER_QUESTION_CAP_SECONDS) / 60));
    expect(minutes).toBeLessThanOrEqual(15);
  });

  it('treats missing timeSeconds as 0, not NaN', () => {
    const results = [{}, { timeSeconds: 30 }];
    expect(computeCappedQuizMinutes(results)).toBe(1);
  });

  it('returns 0 for an empty quiz', () => {
    expect(computeCappedQuizMinutes([])).toBe(0);
  });
});
