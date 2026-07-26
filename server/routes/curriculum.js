const express  = require('express');
const router   = express.Router();
const { client, searchContent, resolveCollection } = require('../services/qdrant');
const { embed } = require('../services/embeddings');
const { normalizeCurriculum } = require('../utils/curriculum');
const { getChapters } = require('../services/chapters');

// Curriculum content changes rarely (only on re-ingestion), but this endpoint
// scrolls thousands of Qdrant points per request — cache each grade+curriculum
// combo for a few minutes so repeat screen visits don't re-pay that cost.
const subjectsCache = new Map(); // key -> { at: number, data: object }
const SUBJECTS_CACHE_TTL_MS = 5 * 60 * 1000;
// The full-tree endpoint below walks every chunk for the grade, so a senior
// grade cost ~27s and 1.5MB on EVERY dashboard load. Cache it the same way.
const treeCache = new Map(); // key -> { at: number, data: object }

// ── GET /curriculum?curriculum=IB_PYP ─────────────────────────────
// Returns all unique topics grouped by grade → subject
// Used by the student Learning Paths screen to populate the full curriculum tree

router.get('/', async (req, res) => {
  try {
    const { grade } = req.query;
    const normCurr = normalizeCurriculum(req.query.curriculum, 'IB PYP');
    const { collection, qdrantCurriculum, qdrantGrade } = resolveCollection(normCurr, grade || null);

    const cacheKey = `${normCurr}|${grade || 'all'}`;
    const cached = treeCache.get(cacheKey);
    if (cached && Date.now() - cached.at < SUBJECTS_CACHE_TTL_MS) return res.json(cached.data);

    const seen   = new Set();
    const topics = [];
    let offset   = null;

    const mustFilters = [{ key: 'curriculum', match: { value: qdrantCurriculum } }];
    if (grade) mustFilters.push({ key: 'grade', match: { value: qdrantGrade } });
    const mustNotFilters = [{ key: 'content_type', match: { value: 'image' } }];

    do {
      const result = await client.scroll(collection, {
        filter:       { must: mustFilters, must_not: mustNotFilters },
        // 100 meant ~110 sequential round-trips for a senior grade (Grade 11 has
        // roughly 10,000 chunks), which is why this endpoint took 27 seconds and
        // the dashboard sat blank until it returned. Same data, a tenth of the
        // trips.
        limit:        1000,
        offset:       offset ?? undefined,
        with_payload: true,
        with_vector:  false,
      });

      for (const point of result.points) {
        const p = point.payload;
        // Defensive: skip anything that is clearly an image caption, even if
        // content_type wasn't tagged correctly at ingest time.
        if (!p.topic || /^\[?IMAGE\]?/i.test(p.topic) || /^this image/i.test(p.topic)) continue;
        const key = `${p.grade}|${p.subject}|${p.topic}`;
        if (!seen.has(key)) {
          seen.add(key);
          topics.push({
            grade:       p.grade,
            subject:     p.subject,
            unit:        p.unit,
            topic:       p.topic,
            description: p.description || p.text || '',
            source:      p.source || '',
          });
        }
      }

      offset = result.next_page_offset ?? null;
    } while (offset !== null);

    // Sort grade → subject → topic
    topics.sort((a, b) => {
      if (a.grade    !== b.grade)    return a.grade.localeCompare(b.grade);
      if (a.subject  !== b.subject)  return a.subject.localeCompare(b.subject);
      return a.topic.localeCompare(b.topic);
    });

    // Group: grade → subject → [{ topic, unit, description }]
    const grouped = {};
    for (const t of topics) {
      if (!grouped[t.grade])           grouped[t.grade]           = {};
      if (!grouped[t.grade][t.subject]) grouped[t.grade][t.subject] = [];
      grouped[t.grade][t.subject].push({
        topic:       t.topic,
        unit:        t.unit,
        description: t.description,
      });
    }

    const grades      = Object.keys(grouped).sort();
    const totalTopics = topics.length;

    const payload = { curriculum: normCurr, grades, topics, grouped, totalTopics };
    treeCache.set(cacheKey, { at: Date.now(), data: payload });
    res.json(payload);
  } catch (err) {
    console.error('Error in GET /curriculum:', err.message);
    res.status(500).json({ error: 'Failed to fetch curriculum data' });
  }
});

// ── GET /curriculum/subjects?grade=Grade+3&curriculum=IB_PYP ──────
// Returns subjects with topic counts + descriptions (for subject card grid in UI)

router.get('/subjects', async (req, res) => {
  try {
    const { grade = 'Grade 3' } = req.query;
    const normCurr2 = normalizeCurriculum(req.query.curriculum, 'IB PYP');
    const { collection: col2, qdrantCurriculum: qCurr2, qdrantGrade: qGrade2 } = resolveCollection(normCurr2, grade);

    const cacheKey = `${col2}|${qCurr2}|${qGrade2}`;
    const cached = subjectsCache.get(cacheKey);
    if (cached && Date.now() - cached.at < SUBJECTS_CACHE_TTL_MS) {
      return res.json(cached.data);
    }

    const seen    = new Set();
    const topicMap = {};   // subject → Set<topic>
    let offset    = null;

    do {
      const result = await client.scroll(col2, {
        filter: {
          must: [
            { key: 'curriculum', match: { value: qCurr2 } },
            { key: 'grade',      match: { value: qGrade2 } },
          ],
          must_not: [{ key: 'content_type', match: { value: 'image' } }],
        },
        limit:        2000,
        offset:       offset ?? undefined,
        // Only pull the fields this endpoint actually uses — the raw chunk
        // "text" field is large and irrelevant here, and fetching it for
        // every point (thousands, for subjects like Mathematics) was the
        // main cause of this screen's slow load.
        with_payload: ['subject', 'topic', 'unit', 'textbook', 'description', 'chapter'],
        with_vector:  false,
      });

      for (const point of result.points) {
        const p = point.payload;
        if (!p.topic || /^\[?IMAGE\]?/i.test(p.topic) || /^this image/i.test(p.topic)) continue;
        const key = `${p.subject}|${p.topic}`;
        if (!seen.has(key)) {
          seen.add(key);
          if (!topicMap[p.subject]) topicMap[p.subject] = [];
          topicMap[p.subject].push({
            topic:       p.topic,
            unit:        p.unit || p.textbook || '',
            description: p.description || p.text || '',
            chapter:     p.chapter || 0,
          });
        }
      }

      offset = result.next_page_offset ?? null;
    } while (offset !== null);

    const subjects = Object.entries(topicMap).map(([subject, topics]) => {
      // Chapter/unit list is the authoritative curriculum structure (from the
      // verified manifests). Prefer it for display counts; fall back to the units
      // embedded in the topic payloads (used by IB PYP, which has no manifests).
      const chapters   = getChapters(normCurr2, grade, subject);
      const unitNames  = [...new Set(topics.map((t) => (t.unit || '').trim()).filter(Boolean))];
      const unitCount  = chapters.length > 0 ? chapters.length : unitNames.length;
      return {
        subject,
        topicCount: topics.length,
        chapterCount: chapters.length,
        unitCount,
        chapters,                        // [{chapter, title}] — chapter/unit names for the UI
        units: chapters.length > 0 ? chapters.map((c) => c.title) : unitNames,
        topics: topics.sort((a, b) => (a.chapter ?? 0) - (b.chapter ?? 0) || a.topic.localeCompare(b.topic)),
      };
    }).sort((a, b) => a.subject.localeCompare(b.subject));

    // For CBSE/NCERT, show ONLY the subjects that officially exist for this grade
    // (per ncert-official-subjects.json, confirmed against ncert.nic.in). This
    // drops IB-PYP subjects that leak in (Arts/PE/CS) and mis-ingested ones
    // (G1 Environmental Studies, G5 Science/Social). IB PYP keeps its own list.
    let outSubjects = subjects;
    try {
      const isNcert = /ncert|cbse/i.test(String(normCurr2 || ''));
      if (isNcert) {
        const OFFICIAL = require('../scripts/ncert-official-subjects.json').byGrade;
        const gNum = (String(grade).match(/(\d+)/) || [])[1];
        const allowed = (OFFICIAL[gNum] || []).map(s => s.toLowerCase());
        if (allowed.length) {
          const norm = s => s.toLowerCase() === 'evs' ? 'environmental studies' : s.toLowerCase();
          outSubjects = subjects.filter(sub => allowed.includes(norm(sub.subject)));
        }
      }
    } catch (_) { /* on any error, fall back to unfiltered */ }

    const responseBody = { grade, curriculum: normCurr2, subjects: outSubjects };
    subjectsCache.set(cacheKey, { at: Date.now(), data: responseBody });
    res.json(responseBody);
  } catch (err) {
    console.error('Error in GET /curriculum/subjects:', err.message);
    res.status(500).json({ error: 'Failed to fetch subjects' });
  }
});

// ── GET /curriculum/search?q=...&grade=Grade+3&subject=...&limit=10 ──
// Semantic search over curriculum content using MiniLM embeddings + Qdrant ANN

router.get('/search', async (req, res) => {
  try {
    const { q, grade, subject, limit = '10' } = req.query;
    const curriculum = normalizeCurriculum(req.query.curriculum, 'IB_PYP');
    if (!q || !q.trim()) return res.status(400).json({ error: 'q (query) is required' });

    const vector  = await embed(q.trim());
    const results = await searchContent({
      vector,
      curriculum,
      grade:   grade   || undefined,
      subject: subject || undefined,
      limit:   Math.min(parseInt(limit, 10) || 10, 30),
    });

    // Deduplicate by topic (return one result per topic, highest score)
    const seen   = new Set();
    const topics = [];
    for (const r of results) {
      const p   = r.payload;
      const key = `${p.grade}|${p.subject}|${p.topic}`;
      if (!seen.has(key)) {
        seen.add(key);
        topics.push({
          topic:       p.topic,
          subject:     p.subject,
          grade:       p.grade,
          unit:        p.unit,
          description: p.description || '',
          score:       r.score,
          snippet:     p.content.slice(0, 180) + '…',
        });
      }
    }

    res.json({ q, topics });
  } catch (err) {
    console.error('Error in GET /curriculum/search:', err.message);
    res.status(500).json({ error: 'Semantic search failed' });
  }
});

module.exports = router;
