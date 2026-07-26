/**
 * orchestrator.js — runs the 12 Curriculum-Intelligence agents in order for a
 * single topic, understand-first:
 *   Retrieve -> Understand -> Strategy -> Generate -> Illustrate -> Audio ->
 *   Quiz -> UI -> Validate -> (Regenerate loop) -> Persist -> Final Audit.
 * functionalQaAgent (module 11) is run once per batch by the caller, not per
 * topic, so it's invoked separately.
 *
 * Never generates before understanding. Output is production-ready JSON.
 */
const { retrieve } = require('./retrievalAgent');                    // 1
const { understand } = require('./curriculumUnderstandingAgent');    // 2
const { selectStrategy } = require('./teachingStrategyAgent');       // 3
const { generate } = require('./lessonGenerationAgent');             // 4
const { illustrate } = require('./illustrationAgent');               // 5
const { buildAudio } = require('./audioAgent');                      // 6
const { buildQuiz } = require('./quizAgent');                        // 7
const { buildLayout } = require('./uiAgent');                        // 8
const { validate } = require('./validationAgent');                   // 9
const { regenerate } = require('./regenerationAgent');               // 10
const { audit } = require('./finalAuditAgent');                      // 12
const { persistLesson } = require('./persist');

const fs = require('fs');
const path = require('path');

async function runTopic({ topicId, title, subject, grade = 1, chapterMeta = {}, pdfFile, bookDir, persist = true, maxRetries = 3, log = console.log }) {
  const trace = { title, stages: {} };

  // 1. Retrieve
  const rag = await retrieve({ title, subject, grade });
  trace.stages.retrieval = { chunks: rag.chunkCount, matched: rag.matched, sourceCode: rag.sourceCode };
  if (rag.cleanText.trim().length < 120) {
    return { ok: false, reason: 'insufficient RAG grounding', trace, audit: null };
  }

  // 2. Understand
  const understanding = await understand({ title, subject, grade, cleanText: rag.cleanText });
  trace.stages.understanding = { type: understanding.instructionalType, bloom: understanding.bloomLevel };
  log(`   [understand] type=${understanding.instructionalType} bloom=${understanding.bloomLevel}`);

  // 3. Strategy
  const strategy = selectStrategy(understanding);
  trace.stages.strategy = { layout: strategy.layoutType, audio: strategy.audio };
  log(`   [strategy] layout=${strategy.layoutType} audio=${strategy.audio}`);

  // 4. Generate
  const lesson = await generate({ title, subject, grade, cleanText: rag.cleanText, understanding, strategy });
  // "View in Book" source PDF: caller-supplied, else the retrieved book code's
  // PDF if it exists in bookDir (e.g. bemr111 -> bemr111.pdf).
  let resolvedPdf = pdfFile;
  if (!resolvedPdf && bookDir && rag.sourceCode) {
    const cand = `${rag.sourceCode}.pdf`;
    if (fs.existsSync(path.join(bookDir, cand))) resolvedPdf = cand;
  }
  lesson.pdfFile = resolvedPdf || undefined;
  lesson.pdfPage = 1;

  // 5. Illustrate (prompts + real figures, no placeholder box)
  await illustrate({ lesson, strategy, chapterMeta });

  // 6. Audio (skipped for maths)
  const audioOut = buildAudio({ lesson, strategy, sourceText: rag.cleanText });
  lesson.audioNarrationScript = audioOut.audioNarrationScript;
  lesson.listenParts = audioOut.listenParts;
  lesson.estListeningTime = audioOut.estListeningSec ? Math.round(audioOut.estListeningSec) : 0;
  if (audioOut.skipped) trace.stages.audio = { skipped: audioOut.skipped };

  // 7. Quiz (non-fatal per founder rule 8)
  try { await buildQuiz({ lesson, understanding, cleanText: rag.cleanText }); }
  catch (e) { log(`   [quiz] failed (continuing): ${e.message}`); lesson.quiz = lesson.quiz || []; trace.stages.quizError = e.message; }

  // 8. UI layout
  buildLayout({ lesson, strategy });

  // 9 + 10. Validate -> regenerate loop
  let validation;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    validation = await validate({ lesson, understanding, strategy, cleanText: rag.cleanText });
    trace.stages[`validation_${attempt}`] = { ok: validation.ok, score: validation.score, defects: validation.defects.map((d) => `${d.section}:${d.reason}`) };
    if (validation.ok) break;
    if (attempt === maxRetries) { log(`   [validate] still failing after ${maxRetries} retries: ${validation.defects.map((d) => d.section).join(',')}`); break; }
    log(`   [regenerate] attempt ${attempt + 1} fixing: ${[...new Set(validation.defects.map((d) => d.section))].join(', ')}`);
    try { await regenerate({ lesson, understanding, strategy, cleanText: rag.cleanText, defects: validation.defects }); }
    catch (e) { log(`   [regenerate] failed: ${e.message}`); break; }
    // Audio/UI depend on regenerated content — rebuild them.
    const a = buildAudio({ lesson, strategy, sourceText: rag.cleanText });
    lesson.audioNarrationScript = a.audioNarrationScript; lesson.listenParts = a.listenParts;
    buildLayout({ lesson, strategy });
  }

  // 12. Final audit
  const auditReport = audit({ lesson, strategy, validation });
  trace.stages.audit = { result: auditReport.result, score: auditReport.overallScore };

  // Persist (only when it has a real body — never overwrite with empty content).
  let persisted = false;
  const bodyOk = (lesson.simplifiedExplanation || []).join(' ').trim().length >= 150;
  if (persist && bodyOk) {
    await persistLesson({ topicId, lesson });
    persisted = true;
  }

  return { ok: validation.ok, persisted, lesson, understanding, strategy, validation, audit: auditReport, trace };
}

module.exports = { runTopic };
