/**
 * Curriculum content API v2 — routes through the generic CurriculumProvider
 * interface (server/services/curriculum) instead of touching Qdrant/Supabase
 * directly. Mounted ALONGSIDE the existing routes/curriculum.js and
 * routes/ncert.js, which are untouched and remain the routes the current
 * mobile app calls — nothing here changes existing traffic.
 *
 * Response shapes are additive-compatible with v1's /curriculum/subjects and
 * /curriculum/search: existing field names are preserved where they overlap,
 * with `status`/`resources` appended for callers that opt into the new data.
 */
const express = require('express');
const router = express.Router();
const { getProvider } = require('../services/curriculum');

// ── GET /curriculum/v2/subjects?grade=Grade+6&curriculum=ICSE ──────────────
router.get('/subjects', async (req, res) => {
  try {
    const { grade, curriculum } = req.query;
    if (!grade) return res.status(400).json({ error: 'grade is required' });

    const provider = getProvider(curriculum);
    const subjects = await provider.listSubjects(grade);

    // Enrich with chapter counts so this stays a useful drop-in replacement
    // for v1's subject-card grid, without requiring a second round trip.
    const enriched = await Promise.all(
      subjects.map(async (s) => {
        const { chapters } = await provider.listUnitsAndChapters(grade, s.id);
        return { subject: s.label, id: s.id, chapterCount: chapters.length };
      })
    );

    res.json({ grade, curriculum: provider.meta.id, subjects: enriched });
  } catch (err) {
    console.error('Error in GET /curriculum/v2/subjects:', err.message);
    res.status(500).json({ error: 'Failed to fetch subjects' });
  }
});

// ── GET /curriculum/v2/topic-content?topicId=...&curriculum=ICSE ───────────
// The primary new endpoint: returns the full ResolvedTopicContent (topic +
// all 8 resource types with status) that student screens will eventually
// render from — the whole point of this pipeline.
router.get('/topic-content', async (req, res) => {
  try {
    const { topicId, curriculum } = req.query;
    if (!topicId) return res.status(400).json({ error: 'topicId is required' });

    const provider = getProvider(curriculum);
    const content = await provider.getTopicContent(topicId);
    res.json({ curriculum: provider.meta.id, ...content });
  } catch (err) {
    console.error('Error in GET /curriculum/v2/topic-content:', err.message);
    res.status(500).json({ error: 'Failed to fetch topic content' });
  }
});

// ── GET /curriculum/v2/search?q=...&grade=...&subject=...&curriculum=... ──
router.get('/search', async (req, res) => {
  try {
    const { q, grade, subject, limit, curriculum } = req.query;
    if (!q || !q.trim()) return res.status(400).json({ error: 'q (query) is required' });

    const provider = getProvider(curriculum);
    const results = await provider.search(q.trim(), {
      gradeId: grade || undefined,
      subjectId: subject || undefined,
      limit: limit ? Math.min(parseInt(limit, 10) || 10, 30) : 10,
    });
    res.json({ q, curriculum: provider.meta.id, topics: results });
  } catch (err) {
    console.error('Error in GET /curriculum/v2/search:', err.message);
    res.status(500).json({ error: 'Semantic search failed' });
  }
});

module.exports = router;
