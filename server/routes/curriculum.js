const express  = require('express');
const router   = express.Router();
const { client, COLLECTION, searchContent } = require('../services/qdrant');
const { embed } = require('../services/embeddings');

// ── GET /curriculum?curriculum=IB_PYP ─────────────────────────────
// Returns all unique topics grouped by grade → subject
// Used by the student Learning Paths screen to populate the full curriculum tree

router.get('/', async (req, res) => {
  try {
    const { grade } = req.query;
    // Qdrant stores 'IB_PYP' (underscore) — normalise both directions
    const curriculum = ((req.query.curriculum || 'IB_PYP') + '').replace(/ /g, '_');

    const seen   = new Set();
    const topics = [];
    let offset   = null;

    const mustFilters = [{ key: 'curriculum', match: { value: curriculum } }];
    if (grade) mustFilters.push({ key: 'grade', match: { value: grade } });

    do {
      const result = await client.scroll(COLLECTION, {
        filter:       { must: mustFilters },
        limit:        100,
        offset:       offset ?? undefined,
        with_payload: true,
        with_vector:  false,
      });

      for (const point of result.points) {
        const p   = point.payload;
        const key = `${p.grade}|${p.subject}|${p.topic}`;
        if (!seen.has(key)) {
          seen.add(key);
          topics.push({
            grade:       p.grade,
            subject:     p.subject,
            unit:        p.unit,
            topic:       p.topic,
            description: p.description || '',
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

    res.json({ curriculum, grades, topics, grouped, totalTopics });
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
    // Qdrant stores 'IB_PYP' (underscore) — normalise both directions
    const curriculum = ((req.query.curriculum || 'IB_PYP') + '').replace(/ /g, '_');

    const seen    = new Set();
    const topicMap = {};   // subject → Set<topic>
    let offset    = null;

    do {
      const result = await client.scroll(COLLECTION, {
        filter: {
          must: [
            { key: 'curriculum', match: { value: curriculum } },
            { key: 'grade',      match: { value: grade      } },
          ],
        },
        limit:        100,
        offset:       offset ?? undefined,
        with_payload: true,
        with_vector:  false,
      });

      for (const point of result.points) {
        const p   = point.payload;
        const key = `${p.subject}|${p.topic}`;
        if (!seen.has(key)) {
          seen.add(key);
          if (!topicMap[p.subject]) topicMap[p.subject] = [];
          topicMap[p.subject].push({
            topic:       p.topic,
            unit:        p.unit,
            description: p.description || '',
          });
        }
      }

      offset = result.next_page_offset ?? null;
    } while (offset !== null);

    const subjects = Object.entries(topicMap).map(([subject, topics]) => ({
      subject,
      topicCount: topics.length,
      topics:     topics.sort((a, b) => a.topic.localeCompare(b.topic)),
    })).sort((a, b) => a.subject.localeCompare(b.subject));

    res.json({ grade, curriculum, subjects });
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
    const curriculum = ((req.query.curriculum || 'IB_PYP') + '').replace(/ /g, '_');
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
