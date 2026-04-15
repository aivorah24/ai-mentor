const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const EVENTS_FILE = path.join(__dirname, '../data/analytics_events.jsonl');

function normalizeEmail(email) {
  return String(email || '').toLowerCase().trim();
}

async function logEvent(eventType, payload = {}) {
  try {
    const record = {
      id: crypto.randomUUID ? crypto.randomUUID() : crypto.randomBytes(16).toString('hex'),
      eventType,
      timestamp: new Date().toISOString(),
      userEmail: normalizeEmail(payload.userEmail),
      role: payload.role || '',
      source: payload.source || '',
      page: payload.page || '',
      path: payload.path || '',
      status: payload.status || '',
      latencyMs: typeof payload.latencyMs === 'number' ? payload.latencyMs : null,
      model: payload.model || '',
      topic: payload.topic || '',
      subject: payload.subject || '',
      grade: payload.grade || '',
      score: typeof payload.score === 'number' ? payload.score : null,
      comment: payload.comment || '',
      meta: payload.meta || {},
    };

    await fs.promises.mkdir(path.dirname(EVENTS_FILE), { recursive: true });
    await fs.promises.appendFile(EVENTS_FILE, `${JSON.stringify(record)}\n`, 'utf8');
    return record;
  } catch {
    return null;
  }
}

async function readEvents() {
  try {
    const raw = await fs.promises.readFile(EVENTS_FILE, 'utf8');
    return raw
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        try {
          return JSON.parse(line);
        } catch {
          return null;
        }
      })
      .filter((item) => item && typeof item === 'object');
  } catch (err) {
    if (err.code === 'ENOENT') return [];
    throw err;
  }
}

function summarizeEvents(events) {
  const aiEvents = events.filter((e) => String(e.eventType || '').startsWith('ai_'));
  const feedbackEvents = events.filter((e) => e.eventType === 'ai_feedback');
  const accessEvents = events.filter((e) => e.eventType === 'app_access' || e.eventType === 'page_view');

  const usersMap = {};
  for (const e of accessEvents) {
    if (!e.userEmail) continue;
    const prev = usersMap[e.userEmail];
    if (!prev || prev.lastSeen < e.timestamp) {
      usersMap[e.userEmail] = { email: e.userEmail, role: e.role || '', lastSeen: e.timestamp };
    }
  }

  const endpointMetrics = {};
  for (const e of aiEvents) {
    const key = e.eventType;
    if (!endpointMetrics[key]) {
      endpointMetrics[key] = { total: 0, success: 0, failed: 0, totalLatencyMs: 0, samples: 0 };
    }
    endpointMetrics[key].total += 1;
    if (e.status === 'success') endpointMetrics[key].success += 1;
    if (e.status === 'error') endpointMetrics[key].failed += 1;
    if (typeof e.latencyMs === 'number') {
      endpointMetrics[key].totalLatencyMs += e.latencyMs;
      endpointMetrics[key].samples += 1;
    }
  }

  const aiMetrics = Object.entries(endpointMetrics).map(([eventType, m]) => ({
    eventType,
    total: m.total,
    success: m.success,
    failed: m.failed,
    avgLatencyMs: m.samples > 0 ? Math.round(m.totalLatencyMs / m.samples) : null,
  }));

  const feedbackBreakdown = {
    total: feedbackEvents.length,
    positive: feedbackEvents.filter((e) => e.score != null && e.score >= 4).length,
    neutral: feedbackEvents.filter((e) => e.score != null && e.score === 3).length,
    negative: feedbackEvents.filter((e) => e.score != null && e.score <= 2).length,
  };

  // Recent feedback with comments (last 20, sorted newest first)
  const recentFeedback = feedbackEvents
    .slice()
    .sort((a, b) => String(b.timestamp || '').localeCompare(String(a.timestamp || '')))
    .slice(0, 20)
    .map(e => ({
      userEmail:  e.userEmail || '',
      role:       e.role || '',
      source:     e.source || '',
      topic:      e.topic || '',
      subject:    e.subject || '',
      score:      e.score ?? null,
      comment:    e.comment || '',
      timestamp:  e.timestamp || '',
    }));

  return {
    totalEvents: events.length,
    accessCount: accessEvents.length,
    uniqueUsers: Object.keys(usersMap).length,
    usersLastSeen: Object.values(usersMap).sort((a, b) => String(b.lastSeen).localeCompare(String(a.lastSeen))),
    aiMetrics,
    feedback: feedbackBreakdown,
    recentFeedback,
  };
}

module.exports = {
  logEvent,
  readEvents,
  summarizeEvents,
};

