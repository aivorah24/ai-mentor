/**
 * Quick test: Mistral Pixtral API for PDF-to-Quiz generation
 *
 * Usage:
 *   1. Add MISTRAL_API_KEY to server/.env
 *   2. Place a test PDF in server/scripts/test-worksheet.pdf
 *   3. Run: node server/scripts/test-pixtral.js
 *
 * If no PDF provided, it tests with a sample math prompt.
 */

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const fs   = require('fs');
const path = require('path');

const MISTRAL_API_KEY = process.env.MISTRAL_API_KEY;
if (!MISTRAL_API_KEY) {
  console.error('❌ MISTRAL_API_KEY not found in server/.env');
  console.error('   Get a free key at: https://console.mistral.ai');
  process.exit(1);
}

const PIXTRAL_MODEL = 'mistral-small-latest'; // vision model (pixtral-large-latest is deprecated)

// ── Send request to Mistral API ─────────────────────────────────────────────
async function callMistral(messages, model = PIXTRAL_MODEL) {
  const res = await fetch('https://api.mistral.ai/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${MISTRAL_API_KEY}`,
    },
    body: JSON.stringify({
      model,
      messages,
      temperature: 0.3,
      max_tokens: 4000,
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Mistral API ${res.status}: ${err}`);
  }

  const data = await res.json();
  return data.choices?.[0]?.message?.content || '';
}

// ── Test 1: Text-based quiz generation (no PDF) ────────────────────────────
async function testTextQuiz() {
  console.log('\n📝 Test 1: Text-based quiz generation (Mistral)');
  console.log('─'.repeat(50));

  const prompt = `You are an expert quiz generator for IB PYP Grade 4 Mathematics.

Generate an interactive quiz in JSON format for the topic "Area & Perimeter".

Return a JSON object with this structure:
{
  "title": "Area & Perimeter",
  "subject": "Mathematics",
  "grade": "PYP 4",
  "tasks": [
    {
      "tier": "MUST DO",
      "title": "Task title",
      "questions": [
        {
          "id": "q1",
          "type": "numeric",
          "question": "Question text with **bold** for key values",
          "unit": "cm",
          "answer": 5,
          "hint": "Hint text",
          "solution": "Step-by-step solution"
        }
      ]
    }
  ]
}

Include:
- 2 MUST DO questions (basic)
- 2 COULD DO questions (application)
- 1 ENRICHMENT question (challenge)

Make questions age-appropriate for 9-10 year olds. Use real-world contexts (parks, rooms, playgrounds).
Return ONLY valid JSON, no markdown fences.`;

  const result = await callMistral([
    { role: 'user', content: prompt }
  ], 'mistral-small-latest'); // Use text model for this test

  console.log('\nResult:');
  console.log(result);

  // Try to parse JSON
  try {
    const quiz = JSON.parse(result);
    console.log('\n✅ Valid JSON! Questions generated:',
      quiz.tasks?.reduce((sum, t) => sum + (t.questions?.length || 0), 0) || 0);
  } catch {
    console.log('\n⚠️  Output is not pure JSON — may need prompt tuning');
  }
}

// ── Test 2: Image-based quiz from PDF page (Pixtral Vision) ────────────────
async function testImageQuiz() {
  const pdfPath = path.join(__dirname, 'test-worksheet.pdf');

  if (!fs.existsSync(pdfPath)) {
    console.log('\n📸 Test 2: Skipped — no test-worksheet.pdf found');
    console.log('   Place a PDF at:', pdfPath);
    console.log('   Then re-run to test Pixtral vision on worksheet images.');
    return;
  }

  console.log('\n📸 Test 2: PDF image → quiz (Pixtral Vision)');
  console.log('─'.repeat(50));

  // Convert first page to image using pdf-parse + canvas
  const pdfParse = require('pdf-parse');
  const buffer   = fs.readFileSync(pdfPath);
  const parsed   = await pdfParse(buffer);

  console.log('PDF text extracted:', parsed.text.substring(0, 200), '...');

  // For vision: render page to image
  let imageBase64 = null;
  try {
    const { applyPolyfills, renderPage } = (() => {
      // Inline simple page render
      const pdfjsLib = require('pdfjs-dist/legacy/build/pdf.js');
      pdfjsLib.GlobalWorkerOptions = pdfjsLib.GlobalWorkerOptions || {};
      pdfjsLib.GlobalWorkerOptions.workerSrc = '';
      return { pdfjsLib };
    })();
    // If pdfjs available, render page
  } catch {
    console.log('   pdfjs not available, using text-only mode');
  }

  // Text-based approach (works without vision)
  const prompt = `You are an expert quiz generator for IB PYP Grade 4 Mathematics.

Here is the content from a worksheet PDF:

---
${parsed.text.substring(0, 3000)}
---

Based on this worksheet content, generate an interactive quiz in JSON format.
Return a JSON object with structure:
{
  "title": "topic title",
  "subject": "Mathematics",
  "grade": "PYP 4",
  "concepts": [
    { "term": "concept name", "definition": "short definition", "unit": "measurement unit" }
  ],
  "tasks": [
    {
      "tier": "MUST DO | COULD DO | ENRICHMENT",
      "title": "Task title",
      "questions": [
        {
          "id": "q1",
          "type": "numeric | mcq | text",
          "question": "Question text",
          "unit": "cm | m | m²",
          "answer": "correct answer",
          "acceptRange": [min, max],
          "hint": "helpful hint",
          "solution": "step-by-step solution"
        }
      ]
    }
  ]
}

Extract the EXACT questions from the worksheet. Preserve difficulty tiers.
Include hints and step-by-step solutions for each question.
Return ONLY valid JSON.`;

  const result = await callMistral([
    { role: 'user', content: prompt }
  ], 'mistral-small-latest');

  console.log('\nResult:');
  console.log(result);

  try {
    const quiz = JSON.parse(result);
    console.log('\n✅ Valid JSON! Questions:',
      quiz.tasks?.reduce((sum, t) => sum + (t.questions?.length || 0), 0) || 0);
  } catch {
    console.log('\n⚠️  Not pure JSON — needs prompt refinement');
  }
}

// ── Test 3: Pixtral Vision on worksheet image ──────────────────────────────
async function testVisionDirect() {
  const imgPath = path.join(__dirname, 'test-worksheet.png');

  if (!fs.existsSync(imgPath)) {
    console.log('\n🔍 Test 3: Skipped — no test-worksheet.png found');
    console.log('   Save a screenshot of a worksheet page as:', imgPath);
    return;
  }

  console.log('\n🔍 Test 3: Pixtral Vision — worksheet image → quiz');
  console.log('─'.repeat(50));

  const imgBuffer = fs.readFileSync(imgPath);
  const base64    = imgBuffer.toString('base64');
  const mimeType  = 'image/png';

  const result = await callMistral([
    {
      role: 'user',
      content: [
        {
          type: 'image_url',
          image_url: { url: `data:${mimeType};base64,${base64}` }
        },
        {
          type: 'text',
          text: `This is a math worksheet page for IB PYP Grade 4.

Extract ALL questions from this image and generate a quiz in JSON format:
{
  "title": "topic from worksheet",
  "questions": [
    {
      "id": "q1",
      "question": "exact question text",
      "type": "numeric | mcq",
      "answer": "correct answer",
      "hint": "helpful hint",
      "solution": "step-by-step solution"
    }
  ]
}

Include diagrams descriptions where relevant.
Return ONLY valid JSON.`
        }
      ]
    }
  ], PIXTRAL_MODEL);

  console.log('\nPixtral Vision Result:');
  console.log(result);
}

// ── Run all tests ───────────────────────────────────────────────────────────
async function main() {
  console.log('🚀 Mistral Pixtral API Test for PDF-to-Quiz');
  console.log('='.repeat(50));
  console.log('API Key:', MISTRAL_API_KEY.substring(0, 8) + '...');

  await testTextQuiz();
  await testImageQuiz();
  await testVisionDirect();

  console.log('\n' + '='.repeat(50));
  console.log('Done! If tests pass, Mistral can be used for quiz generation.');
}

main().catch(err => {
  console.error('❌ Error:', err.message);
  process.exit(1);
});
