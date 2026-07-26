/**
 * Stage 2 — Structured Lesson Generation (curriculum/grade/subject-agnostic).
 *
 * Takes Stage 1's extraction output and produces the canonical Math Lesson
 * Schema (see docs/math-lesson-schema.md) via LLM calls. Nothing here is
 * specific to a grade, subject, or chapter — all of that comes from `meta`
 * and the extraction payload passed in.
 */
const fs   = require('fs');
const path = require('path');

// When run standalone (CLI), load .env before pulling in services that read
// process.env at require-time (e.g. Supabase client construction).
if (require.main === module) {
  require('dotenv').config({ path: path.join(__dirname, '../../.env') });
}

const { generateJSON } = require('../../services/llm');
const { findFigures }  = require('../../services/figuresIndex');
const { answersMatch, toNumber } = require('../../services/answerMatch');

const LESSONS_ROOT = path.join(__dirname, '../../data/lessons/math');

function outputPath({ curriculum, grade, subject, chapterCode }) {
  const gradeNum = (String(grade).match(/\d+/) || [''])[0];
  return path.join(LESSONS_ROOT, curriculum, `grade${gradeNum}`, subject, `${chapterCode}.json`);
}

const SYSTEM_PROMPT = `You are a curriculum content engineer building step-by-step math lessons for an
AI tutoring app. Voice/narration must NEVER read out a mathematical expression, equation, or
number sequence — narration is only plain-language reasoning ("we isolate the variable first",
"we find a common denominator"). The actual math (numbers, symbols, equations) belongs only in
the visual/text fields, never in a spoken field. Always respond with a single JSON object, no
markdown fences, matching exactly the schema requested by the user message.`;

async function generateConcept({ chapterTitle, conceptText, formulas, grade, subject }) {
  const userPrompt = `Grade: ${grade}, Subject: ${subject}
Chapter source text (from the real NCERT textbook):
"""
${conceptText.slice(0, 3000)}
"""
Rough formula/expression candidates spotted in the text (may include noise — use judgement): ${JSON.stringify(formulas)}

Return JSON with this exact shape:
{
  "concept": { "title": string, "description": string, "learningObjective": string, "prerequisites": string[] },
  "formulas": [{ "name": string, "expression": string, "description": string }],
  "properties": [{ "title": string, "description": string }]
}
Base everything on the chapter source text above — do not invent unrelated topics. "${chapterTitle}" is a rough page-scrape guess for the title; use the source text to determine the real chapter title.`;

  return generateJSON({ systemPrompt: SYSTEM_PROMPT, userPrompt, maxTokens: 1200 });
}

async function generateStepsForProblem({ problemText, officialAnswer, grade, subject }) {
  const answerRule = officialAnswer
    ? `The official answer is: "${officialAnswer}". Your steps MUST arrive at exactly this answer — do not contradict it.`
    : `No official answer is given — solve it yourself and state the final answer.`;

  const userPrompt = `Grade: ${grade}, Subject: ${subject}
Problem: "${problemText}"
${answerRule}

Return JSON with this exact shape:
{
  "spokenIntro": string,          // plain-language reasoning only, NO equations/numbers-as-math
  "steps": [
    { "stepText": string, "spokenExplanation": string, "visual": string|null }
  ],
  "finalAnswer": string,
  "commonMistake": string|null,
  "hint": string|null
}
"stepText" and "visual" may contain the actual math (numbers, fractions, symbols). "spokenIntro" and
"spokenExplanation" must NEVER contain a raw equation or fraction — describe the reasoning in words only.`;

  return generateJSON({ systemPrompt: SYSTEM_PROMPT, userPrompt, maxTokens: 900 });
}

/**
 * @param {object} extraction  - output of extractChapter()
 * @param {object} opts
 * @param {number} opts.workedExampleCount   - how many qaPairs become illustrative workedExamples
 * @param {number} opts.exerciseCount        - how many qaPairs become exerciseQuestions
 * @param {number} opts.practiceCount        - how many qaPairs become practiceProblems (answer withheld from student)
 */
async function generateLesson(extraction, opts = {}) {
  const { meta, chapterTitle, conceptText, formulas, qaPairs } = extraction;
  const { curriculum, grade, subject, chapterCode } = meta;
  const {
    workedExampleCount = 2,
    exerciseCount = 4,
    practiceCount = 3,
  } = opts;

  const { concept, formulas: structuredFormulas, properties } = await generateConcept({
    chapterTitle, conceptText, formulas, grade, subject,
  });

  const pool = qaPairs.slice(0, workedExampleCount + exerciseCount + practiceCount);
  const solved = [];
  for (const qa of pool) {
    // Correctness gate: only enforceable when the official answer is a single
    // parseable number/fraction (many OCR'd answers are compound multi-part
    // strings, e.g. "a. 1/3 b. 2/9 c. 1/3", which this simple checker can't
    // reliably parse — for those we can't algorithmically verify either way,
    // so we don't gate rather than falsely dropping correct problems).
    // When it IS parseable, a fallback model (Groq rate-limit path) was
    // observed inventing self-consistent-looking but WRONG steps landing on
    // a different number entirely — one retry, then drop rather than ever
    // serving a student a wrong worked solution.
    const officialIsCheckable = qa.officialAnswer && toNumber(qa.officialAnswer) !== null;
    let result = null;
    for (let attempt = 1; attempt <= 2 && !result; attempt++) {
      try {
        const candidate = await generateStepsForProblem({ ...qa, grade, subject });
        // A declared finalAnswer that string/numeric-matches the official
        // answer isn't enough — the LLM can parrot back the right-looking
        // answer while its own steps computed something else entirely
        // (observed: steps concluding "= 3 kg" while finalAnswer claimed
        // "3/4"). Cross-check the trailing "= <value>" in the LAST step
        // against the official answer too; both must agree when parseable.
        const lastStep = candidate.steps?.[candidate.steps.length - 1];
        const lastStepText = lastStep ? (lastStep.visual || lastStep.stepText || '') : '';
        // Prefer the value after a trailing "=" when present; many final
        // steps are just the bare answer with no "=" at all (e.g. "3 1/2"),
        // so fall back to the whole trimmed step text in that case.
        const lastStepValue = (lastStepText.match(/=\s*([^=]+)$/)?.[1] || lastStepText).trim();
        const lastStepCheckable = lastStepValue && toNumber(lastStepValue) !== null;

        const finalAnswerOk = !officialIsCheckable || answersMatch(candidate.finalAnswer, qa.officialAnswer);
        const lastStepOk = !officialIsCheckable || !lastStepCheckable || answersMatch(lastStepValue, qa.officialAnswer);

        if (finalAnswerOk && lastStepOk) {
          result = candidate;
        } else {
          console.warn(`[math/generate] attempt ${attempt}: finalAnswer="${candidate.finalAnswer}" lastStep="${lastStepValue}" != official "${qa.officialAnswer}" — ${attempt < 2 ? 'retrying' : 'dropping problem'}`);
        }
      } catch (err) {
        console.warn(`[math/generate] attempt ${attempt} failed:`, err.message);
      }
    }
    if (!result) continue;
    // Deliberately NOT using the LLM's free-restated problem text — it
    // hallucinated numbers inconsistent with the official answer in testing.
    // The sanitized raw OCR text (extract.js strips the font-glyph artifacts
    // already) is less pretty but never wrong.
    solved.push({ problem: qa.problemText, officialAnswer: qa.officialAnswer, ...result });
  }

  const workedExamples = solved.slice(0, workedExampleCount).map(s => ({
    problem: s.problem, spokenIntro: s.spokenIntro, steps: s.steps, finalAnswer: s.finalAnswer,
  }));
  const exerciseQuestions = solved.slice(workedExampleCount, workedExampleCount + exerciseCount).map(s => ({
    problem: s.problem, officialAnswer: s.officialAnswer, steps: s.steps,
    commonMistake: s.commonMistake, hint: s.hint,
  }));
  const practiceProblems = solved.slice(workedExampleCount + exerciseCount).map(s => ({
    problem: s.problem, hint: s.hint, finalAnswer: s.finalAnswer,
  }));

  const visuals = findFigures({ grade, subject, code: chapterCode })
    .slice(0, 6)
    .map(f => ({ description: `${subject} — ${f.code} p.${f.page}`, figureUrl: f.url }));

  const lesson = {
    meta: { curriculum, grade, subject, chapterCode, chapterTitle: concept.title, generatedAt: new Date().toISOString() },
    concept,
    formulas: structuredFormulas,
    properties,
    visuals,
    workedExamples,
    exerciseQuestions,
    practiceProblems,
    assessment: [], // phase 2
  };

  const outPath = outputPath(meta);
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(lesson, null, 2));

  return { lesson, outPath };
}

module.exports = { generateLesson, outputPath };

// CLI: node generate.js --curriculum NCERT --grade 6 --subject Mathematics --code fegp107
if (require.main === module) {
  const { extractChapter } = require('./extract');
  const args = Object.fromEntries(
    process.argv.slice(2).reduce((acc, arg, i, arr) => {
      if (arg.startsWith('--')) acc.push([arg.slice(2), arr[i + 1]]);
      return acc;
    }, [])
  );
  const meta = { curriculum: args.curriculum || 'NCERT', grade: args.grade, subject: args.subject, chapterCode: args.code };

  (async () => {
    const realLog = console.log;
    console.log = () => {}; // silence pdf-parse noise during extraction
    const extraction = await extractChapter(meta);
    console.log = realLog;

    const { outPath } = await generateLesson(extraction);
    console.log('Lesson written to', outPath);
  })().catch(err => {
    console.error('Generation failed:', err);
    process.exit(1);
  });
}
