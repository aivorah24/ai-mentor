/**
 * routes/mathEngine.js — AI Teaching Engine (Stage 3 of the Math Learning
 * Engine pipeline). Serves the canonical lesson JSON produced by
 * pipelines/math/generate.js and checks practice-problem answers.
 *
 * Curriculum/grade/subject/chapter-agnostic: every endpoint resolves its file
 * path generically from query params, the same way generate.js writes it.
 */
const express = require('express');
const fs      = require('fs');
const router  = express.Router();

const { outputPath } = require('../pipelines/math/generate');
const { answersMatch } = require('../services/answerMatch');

function loadLesson({ curriculum, grade, subject, code }) {
  const filePath = outputPath({ curriculum, grade, subject, chapterCode: code });
  if (!fs.existsSync(filePath)) return null;
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

// GET /math-engine/lesson?curriculum=NCERT&grade=6&subject=Mathematics&code=fegp107
router.get('/lesson', (req, res) => {
  const { curriculum = 'NCERT', grade, subject, code } = req.query;
  if (!grade || !subject || !code) {
    return res.status(400).json({ error: 'grade, subject and code are required' });
  }
  const lesson = loadLesson({ curriculum, grade, subject, code });
  if (!lesson) {
    return res.status(404).json({ error: `No math lesson generated yet for ${curriculum}/grade${grade}/${subject}/${code}` });
  }
  res.json(lesson);
});

// POST /math-engine/check-answer
// body: { curriculum, grade, subject, code, problemIndex, studentAnswer }
router.post('/check-answer', (req, res) => {
  const { curriculum = 'NCERT', grade, subject, code, problemIndex, studentAnswer } = req.body || {};
  if (!grade || !subject || !code || problemIndex === undefined) {
    return res.status(400).json({ error: 'grade, subject, code and problemIndex are required' });
  }
  const lesson = loadLesson({ curriculum, grade, subject, code });
  if (!lesson) return res.status(404).json({ error: 'lesson not found' });

  const problem = lesson.practiceProblems?.[problemIndex];
  if (!problem) return res.status(404).json({ error: 'practice problem not found at that index' });

  const correct = answersMatch(studentAnswer, problem.finalAnswer);
  res.json({ correct, hint: correct ? null : problem.hint, finalAnswer: correct ? problem.finalAnswer : undefined });
});

module.exports = router;
