/**
 * routes/contentReview.js
 * Read-only reporting endpoint for the content-review pipeline's stored
 * metadata (server/scripts/review-content.js). Modular by design — the
 * curriculum/grade/subject in the URL map to a metadata file; adding a new
 * curriculum later just means pointing at its own metadata file here.
 */
const express = require('express');
const fs = require('fs');
const path = require('path');
const router = express.Router();

// curriculum|grade|subject → metadata file. Extend this map as more
// curricula/grades get their own review pipeline run.
const METADATA_FILES = {
  'cbse|grade 6|english': path.join(__dirname, '../data/generated/englishG6ReviewMetadata.json'),
};

function keyFor(curriculum, grade, subject) {
  return `${String(curriculum).toLowerCase()}|${String(grade).toLowerCase()}|${String(subject).toLowerCase()}`;
}

// GET /content-review/:curriculum/:grade/:subject
router.get('/:curriculum/:grade/:subject', (req, res) => {
  const { curriculum, grade, subject } = req.params;
  const file = METADATA_FILES[keyFor(curriculum, grade, subject)];
  if (!file || !fs.existsSync(file)) {
    return res.json({ curriculum, grade, subject, chapters: [], summary: null });
  }

  let chapters;
  try {
    chapters = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (err) {
    return res.status(500).json({ error: `Could not read review metadata: ${err.message}` });
  }

  if (chapters.length === 0) {
    return res.json({ curriculum, grade, subject, chapters: [], summary: null });
  }

  const overalls = chapters.map((c) => c.overall);
  const published = chapters.filter((c) => c.published);
  const needsReview = chapters.filter((c) => !c.published);
  const avgCoverage = chapters.reduce((s, c) => s + (c.coverage || 0), 0) / chapters.length;

  const summary = {
    totalChapters: chapters.length,
    averageScore: Math.round((overalls.reduce((a, b) => a + b, 0) / overalls.length) * 10) / 10,
    lowestScore: Math.min(...overalls),
    highestScore: Math.max(...overalls),
    needsReviewCount: needsReview.length,
    publishedCount: published.length,
    coveragePercent: Math.round(avgCoverage * 10) / 10,
  };

  res.json({ curriculum, grade, subject, chapters, summary });
});

module.exports = router;
