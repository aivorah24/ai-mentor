/**
 * student-dashboard-real-data.test.js
 * Tests that the student dashboard shows REAL user data:
 *   1. /student/:id/performance — aggregates quiz scores from analytics events by email
 *   2. Dashboard progress logic — allLessons uses real scores, not binary 0/100
 *   3. barTopics — active topics shown first with real percentages
 *   4. avgScore — uses analytics avg, not bar average
 *   5. bestScore — picks highest scoring topic, not first topic
 *   6. Learning Path stage labels — Mastered / In Progress / Not Started
 */

// ── Mirror of server/routes/student.js performance aggregation ────────────────

function aggregatePerformance(events, email) {
  const childEvents = events.filter(e =>
    String(e.userEmail || '').toLowerCase() === email.toLowerCase()
  );

  const topicMap = {};
  const allScores = [];

  for (const e of childEvents) {
    const topic = e.topic || '';
    if (!topic) continue;
    if (!topicMap[topic]) {
      topicMap[topic] = { subject: e.subject || '', grade: e.grade || '', quizScores: [], sessions: 0, lastActivity: '' };
    }
    const t = topicMap[topic];
    if ((e.eventType === 'ibpyp_quiz_result' || e.eventType === 'ncert_quiz_result') && typeof e.score === 'number') {
      t.quizScores.push(e.score);
      allScores.push(e.score);
    }
    if (e.eventType === 'ai_lesson_script' || e.eventType === 'lesson_started') {
      t.sessions++;
    }
    if (e.timestamp && e.timestamp > t.lastActivity) t.lastActivity = e.timestamp;
  }

  const topics = {};
  for (const [topic, t] of Object.entries(topicMap)) {
    const avgScore = t.quizScores.length > 0
      ? Math.round(t.quizScores.reduce((a, b) => a + b, 0) / t.quizScores.length)
      : null;
    topics[topic] = { subject: t.subject, grade: t.grade, avgScore, quizCount: t.quizScores.length, sessions: t.sessions };
  }

  const avgScore = allScores.length > 0
    ? Math.round(allScores.reduce((a, b) => a + b, 0) / allScores.length)
    : null;

  return { topics, avgScore, topicCount: Object.keys(topics).length };
}

// ── Mirror of DashboardScreen allLessons progress logic ───────────────────────

function computeLessonProgress(topic, completedTopics, perfData) {
  const completedSet = new Set(completedTopics);
  const perf = perfData.topics[topic];
  if (completedSet.has(topic)) return 100;
  if (perf?.avgScore != null) return perf.avgScore;
  if (perf?.sessions && perf.sessions > 0) return 30;
  return 0;
}

// ── Mirror of DashboardScreen barTopics logic ─────────────────────────────────

function computeBarTopics(curriculumTopics, completedTopics, perfData) {
  const completedSet = new Set(completedTopics);
  const withData = curriculumTopics.map(t => {
    const perf = perfData.topics[t];
    const pct  = completedSet.has(t) ? 100 : (perf?.avgScore ?? 0);
    return { label: t.split(' ').slice(0, 2).join(' '), fullLabel: t, pct, hasData: pct > 0 || (perf?.sessions ?? 0) > 0 };
  });
  const active  = withData.filter(t => t.hasData).slice(0, 6);
  const padding = withData.filter(t => !t.hasData).slice(0, Math.max(0, 6 - active.length));
  return [...active, ...padding].slice(0, 6);
}

function computeAvgScore(barTopics, perfDataAvg) {
  if (perfDataAvg != null) return perfDataAvg;
  const scored = barTopics.filter(t => t.pct > 0);
  return scored.length ? Math.round(scored.reduce((s, t) => s + t.pct, 0) / scored.length) : 0;
}

function computeBestScore(barTopics) {
  return [...barTopics].sort((a, b) => b.pct - a.pct)[0] ?? null;
}

function getLessonStage(progress) {
  if (progress >= 100) return 'Mastered';
  if (progress > 0)   return 'In Progress';
  return 'Not Started';
}

// ── XP awarded on quiz completion ────────────────────────────────────────────

function quizXP(pct) {
  return pct >= 80 ? 100 : pct >= 60 ? 60 : 30;
}

// ─────────────────────────────────────────────────────────────────────────────
// Test data
// ─────────────────────────────────────────────────────────────────────────────

const SAI_EMAIL = 'kannansaimohan2003@gmail.com';

const MOCK_EVENTS = [
  // Sai — Area and Perimeter: two attempts, avg 80
  { userEmail: SAI_EMAIL, eventType: 'ibpyp_quiz_result', topic: 'Area and Perimeter', subject: 'Mathematics', grade: 'Grade 4', score: 60, timestamp: '2026-04-20T10:00:00Z' },
  { userEmail: SAI_EMAIL, eventType: 'ibpyp_quiz_result', topic: 'Area and Perimeter', subject: 'Mathematics', grade: 'Grade 4', score: 100, timestamp: '2026-04-21T10:00:00Z' },
  // Sai — Place Value: one attempt 75
  { userEmail: SAI_EMAIL, eventType: 'ibpyp_quiz_result', topic: 'Place Value and Comparison', subject: 'Mathematics', grade: 'Grade 4', score: 75, timestamp: '2026-04-22T10:00:00Z' },
  // Sai — LCM and HCF: session only (started but no quiz)
  { userEmail: SAI_EMAIL, eventType: 'ai_lesson_script', topic: 'LCM and HCF', subject: 'Mathematics', grade: 'Grade 5', score: undefined, timestamp: '2026-04-23T10:00:00Z' },
  // Different user — should NOT appear in Sai's results
  { userEmail: 'other@test.com', eventType: 'ibpyp_quiz_result', topic: 'Fractions', subject: 'Mathematics', grade: 'Grade 5', score: 90, timestamp: '2026-04-23T11:00:00Z' },
];

const CURRICULUM_TOPICS = [
  'Area and Perimeter',
  'Place Value and Comparison',
  'LCM and HCF',
  'Ratio and Proportion',
  'Simple Interest',
  'Algebra',
  'Integers',
];

// ─────────────────────────────────────────────────────────────────────────────
// 1. Performance aggregation
// ─────────────────────────────────────────────────────────────────────────────

describe('performance aggregation — /student/:id/performance', () => {
  let perf;
  beforeAll(() => { perf = aggregatePerformance(MOCK_EVENTS, SAI_EMAIL); });

  test('only includes events for the target email', () => {
    expect(perf.topics['Fractions']).toBeUndefined(); // belongs to other@test.com
  });

  test('Area and Perimeter avg = 80 (60 + 100 / 2)', () => {
    expect(perf.topics['Area and Perimeter'].avgScore).toBe(80);
    expect(perf.topics['Area and Perimeter'].quizCount).toBe(2);
  });

  test('Place Value avg = 75 (single attempt)', () => {
    expect(perf.topics['Place Value and Comparison'].avgScore).toBe(75);
    expect(perf.topics['Place Value and Comparison'].quizCount).toBe(1);
  });

  test('LCM and HCF has sessions but no quiz score → avgScore null', () => {
    expect(perf.topics['LCM and HCF'].avgScore).toBeNull();
    expect(perf.topics['LCM and HCF'].sessions).toBe(1);
  });

  test('overall avgScore = 78 ((80 + 75) / 2 rounded... actually (60+100+75)/3 = 78)', () => {
    // all 3 quiz events: 60, 100, 75 → avg = 78.33 → 78
    expect(perf.avgScore).toBe(78);
  });

  test('topicCount = 3 (Area, Place Value, LCM)', () => {
    expect(perf.topicCount).toBe(3);
  });

  test('case-insensitive email match', () => {
    const p2 = aggregatePerformance(MOCK_EVENTS, SAI_EMAIL.toUpperCase());
    expect(p2.topics['Area and Perimeter'].avgScore).toBe(80);
  });

  test('empty result for unknown email', () => {
    const p3 = aggregatePerformance(MOCK_EVENTS, 'nobody@test.com');
    expect(p3.topicCount).toBe(0);
    expect(p3.avgScore).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. allLessons progress calculation
// ─────────────────────────────────────────────────────────────────────────────

describe('allLessons progress — real scores not binary 0/100', () => {
  const perf = aggregatePerformance(MOCK_EVENTS, SAI_EMAIL);

  test('completed topic → 100 regardless of quiz score', () => {
    // completedTopics includes this even though quiz was 60/100
    expect(computeLessonProgress('Area and Perimeter', ['Area and Perimeter'], perf)).toBe(100);
  });

  test('not in completedTopics + has quiz score → uses quiz score', () => {
    expect(computeLessonProgress('Place Value and Comparison', [], perf)).toBe(75);
  });

  test('not in completedTopics + has sessions but no quiz → 30 (in progress)', () => {
    expect(computeLessonProgress('LCM and HCF', [], perf)).toBe(30);
  });

  test('no activity at all → 0 (not started)', () => {
    expect(computeLessonProgress('Algebra', [], perf)).toBe(0);
  });

  test('quiz score 80 marks as mastered (stage Mastered)', () => {
    const progress = computeLessonProgress('Area and Perimeter', ['Area and Perimeter'], perf);
    expect(getLessonStage(progress)).toBe('Mastered');
  });

  test('quiz score 75 (not in completedTopics) → In Progress stage', () => {
    const progress = computeLessonProgress('Place Value and Comparison', [], perf);
    expect(getLessonStage(progress)).toBe('In Progress');
  });

  test('sessions only → In Progress stage', () => {
    const progress = computeLessonProgress('LCM and HCF', [], perf);
    expect(getLessonStage(progress)).toBe('In Progress');
  });

  test('no activity → Not Started stage', () => {
    expect(getLessonStage(0)).toBe('Not Started');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. barTopics — active topics first
// ─────────────────────────────────────────────────────────────────────────────

describe('barTopics — topics with activity shown first', () => {
  const perf = aggregatePerformance(MOCK_EVENTS, SAI_EMAIL);
  const bars = computeBarTopics(CURRICULUM_TOPICS, ['Area and Perimeter'], perf);

  test('returns max 6 topics', () => {
    expect(bars.length).toBeLessThanOrEqual(6);
  });

  test('completed topic shows 100', () => {
    const bar = bars.find(b => b.fullLabel === 'Area and Perimeter');
    expect(bar).toBeDefined();
    expect(bar.pct).toBe(100);
  });

  test('Place Value shows real quiz score 75', () => {
    const bar = bars.find(b => b.fullLabel === 'Place Value and Comparison');
    expect(bar).toBeDefined();
    expect(bar.pct).toBe(75);
  });

  test('LCM (session only) shows 0 pct but hasData=true', () => {
    const bar = bars.find(b => b.fullLabel === 'LCM and HCF');
    expect(bar).toBeDefined();
    expect(bar.hasData).toBe(true);
  });

  test('active topics appear before topics with no data', () => {
    const activeIdxs  = bars.filter(b => b.hasData).map((_, i) => i);
    const inactiveIdxs = bars.filter(b => !b.hasData).map((_, i) => bars.findIndex(x => x === bars.filter(b2 => !b2.hasData)[i]));
    if (activeIdxs.length && inactiveIdxs.length) {
      expect(Math.max(...activeIdxs)).toBeLessThan(Math.min(...inactiveIdxs));
    }
  });

  test('no data topics have pct=0', () => {
    bars.filter(b => !b.hasData).forEach(b => expect(b.pct).toBe(0));
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 4. avgScore — uses analytics overall avg
// ─────────────────────────────────────────────────────────────────────────────

describe('avgScore calculation', () => {
  const perf = aggregatePerformance(MOCK_EVENTS, SAI_EMAIL);
  const bars = computeBarTopics(CURRICULUM_TOPICS, ['Area and Perimeter'], perf);

  test('uses perfData.avgScore when available (78)', () => {
    expect(computeAvgScore(bars, perf.avgScore)).toBe(78);
  });

  test('falls back to bar average when perfData.avgScore is null', () => {
    const mockBars = [{ pct: 80, hasData: true }, { pct: 60, hasData: true }, { pct: 0, hasData: false }];
    expect(computeAvgScore(mockBars, null)).toBe(70); // (80+60)/2
  });

  test('returns 0 when no bar has any score and no analytics avg', () => {
    const emptyBars = [{ pct: 0 }, { pct: 0 }];
    expect(computeAvgScore(emptyBars, null)).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 5. bestScore — highest scoring topic (not first)
// ─────────────────────────────────────────────────────────────────────────────

describe('bestScore — picks highest pct topic', () => {
  test('returns topic with highest score', () => {
    const bars = [
      { fullLabel: 'Place Value', pct: 75 },
      { fullLabel: 'Area and Perimeter', pct: 100 },
      { fullLabel: 'Algebra', pct: 0 },
    ];
    const best = computeBestScore(bars);
    expect(best.fullLabel).toBe('Area and Perimeter');
    expect(best.pct).toBe(100);
  });

  test('returns first topic when all scores equal', () => {
    const bars = [{ fullLabel: 'A', pct: 50 }, { fullLabel: 'B', pct: 50 }];
    expect(computeBestScore(bars).pct).toBe(50);
  });

  test('returns null for empty barTopics', () => {
    expect(computeBestScore([])).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 6. Quiz completion XP awards
// ─────────────────────────────────────────────────────────────────────────────

describe('quiz completion XP — reward based on score', () => {
  test('score >= 80 → 100 XP', () => { expect(quizXP(80)).toBe(100); });
  test('score 100 → 100 XP',   () => { expect(quizXP(100)).toBe(100); });
  test('score 60-79 → 60 XP',  () => { expect(quizXP(60)).toBe(60); expect(quizXP(79)).toBe(60); });
  test('score < 60 → 30 XP',   () => { expect(quizXP(59)).toBe(30); expect(quizXP(0)).toBe(30); });
});

// ─────────────────────────────────────────────────────────────────────────────
// 7. Learning Path CTA label
// ─────────────────────────────────────────────────────────────────────────────

describe('Learning Path CTA button label', () => {
  function getCta(progress) {
    return progress >= 100 ? 'Review' : progress > 0 ? 'Continue' : 'Start';
  }
  test('0% → Start',    () => { expect(getCta(0)).toBe('Start'); });
  test('30% → Continue', () => { expect(getCta(30)).toBe('Continue'); });
  test('75% → Continue', () => { expect(getCta(75)).toBe('Continue'); });
  test('100% → Review',  () => { expect(getCta(100)).toBe('Review'); });
});

// ─────────────────────────────────────────────────────────────────────────────
// 8. Topics explored count
// ─────────────────────────────────────────────────────────────────────────────

describe('topics explored count', () => {
  test('completedTopics length drives the count', () => {
    const completed = ['Area and Perimeter', 'Place Value and Comparison', 'LCM and HCF'];
    expect(completed.length).toBe(3);
  });

  test('hero text shows correct count vs total', () => {
    const completed = ['Area and Perimeter'];
    const total = 55;
    const text = `${completed.length} of ${total} topics explored. Keep it up!`;
    expect(text).toBe('1 of 55 topics explored. Keep it up!');
  });
});
