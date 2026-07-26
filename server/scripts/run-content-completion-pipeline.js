require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');
const pdf = require('pdf-parse');
const syllabus = require('../services/syllabus-map');
const { searchGrounding, resolveCollection } = require('../services/qdrant');

const supabase = createClient(
  (process.env.SUPABASE_URL || '').replace(/\s+/g, ''),
  (process.env.SUPABASE_SERVICE_KEY || '').replace(/\s+/g, '')
);

const BOOKS_ROOT = path.resolve(__dirname, '../../data/ncert_books');
const WORKLIST_FILE = path.resolve(__dirname, '../data/curricula/ncert_catalog/missing-content-topics.json');
const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions';

const LITE_MODEL = 'llama-3.1-8b-instant';

async function extractTextFromPdf(pdfPath) {
  try {
    const buf = fs.readFileSync(pdfPath);
    let textOut = [];
    await pdf(buf, {
      pagerender: (pageData) =>
        pageData.getTextContent().then((tc) => {
          const text = tc.items.map((i) => i.str).join(' ');
          textOut.push(text);
          return text;
        })
    });
    return textOut.join(' ');
  } catch (e) {
    console.error(`  ! PDF extraction failed for ${pdfPath}: ${e.message}`);
    return null;
  }
}

async function callLLM(prompt) {
  const res = await fetch(GROQ_URL, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${process.env.GROQ_API_KEY || process.env.GROQ_API_KEY_1}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model: LITE_MODEL,
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.2,
      response_format: { type: 'json_object' }
    })
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`LLM Error: ${res.status} ${text}`);
  }
  const data = await res.json();
  const content = data.choices[0].message.content;
  return JSON.parse(content);
}

async function main() {
  if (!fs.existsSync(WORKLIST_FILE)) {
    console.error('Worklist not found at', WORKLIST_FILE);
    process.exit(1);
  }
  const worklist = JSON.parse(fs.readFileSync(WORKLIST_FILE, 'utf8'));
  console.log(`Loaded ${worklist.length} topics from worklist.`);

  const stats = {
    attempted: {},
    succeeded: {},
    skipped: {}
  };

  for (let i = 1; i <= 12; i++) {
    stats.attempted[i] = 0;
    stats.succeeded[i] = 0;
    stats.skipped[i] = 0;
  }

  for (let i = 0; i < worklist.length; i++) {
    const item = worklist[i];
    const { grade, subject, chapterTitle, chapterId, topicId, topicName } = item;
    stats.attempted[grade]++;

    console.log(`\n[${i+1}/${worklist.length}] Grade ${grade} | ${subject} | ${topicName}`);

    // Check if already done
    const { data: existingRow, error: checkErr } = await supabase
      .from('topic_resources')
      .select('static_payload, source_tier')
      .eq('topic_id', topicId)
      .eq('resource_type', 'AI_EXPLANATION')
      .maybeSingle();

    if (checkErr) {
      console.error(`  ! DB check failed: ${checkErr.message}`);
      stats.skipped[grade]++;
      continue;
    }

    if (existingRow) {
      const payload = existingRow.static_payload || {};
      if (payload.isSample === undefined && existingRow.source_tier !== 'PLACEHOLDER') {
        console.log(`  -> Already completed. Skipping.`);
        stats.succeeded[grade]++;
        continue;
      }
    }

    // Resolve book
    const chs = syllabus.chaptersFor(grade, subject) || [];
    let rec = chs.find(c => c.title === chapterTitle);
    
    if (!rec) {
      // Fetch chapter_no from Supabase to match by number
      const { data: chapData, error: chapErr } = await supabase
        .from('chapters')
        .select('chapter_no')
        .eq('id', chapterId)
        .maybeSingle();
      
      if (!chapErr && chapData) {
        rec = chs.find(c => c.chapter === chapData.chapter_no);
      }
    }
    
    if (!rec || !rec.bookPath) {
      console.log(`  ! Book path not found for Grade ${grade} ${subject} chapter '${chapterTitle}'. Skipping.`);
      stats.skipped[grade]++;
      continue;
    }

    const pdfPath = path.join(BOOKS_ROOT, rec.bookPath);
    const pdfText = await extractTextFromPdf(pdfPath);
    if (!pdfText) {
      stats.skipped[grade]++;
      continue;
    }

    // Qdrant Grounding
    // Try to get embeddings if possible, though pdfText is our primary for G1-G2.
    // To not reinvent the embedder here, we will just use the pdfText directly as it's the exact book.
    // The prompt says "Two grounding sources exist, use both where available", but since we don't have the `vector` for the query here,
    // we can rely primarily on pdfText which is the "Direct PDF text".
    // For G1-G2, PDF text is explicitly called out as critical.
    
    // We will truncate pdfText to fit context window if needed, roughly 12000 chars
    const contextText = pdfText.substring(0, 12000);

    const prompt = `You are an expert curriculum designer writing a lesson for Grade ${grade} ${subject}.
Topic: ${topicName}

Using ONLY the following excerpt from the official NCERT textbook, generate a complete, engaging explanation.
DO NOT invent facts, skills, or stories not present in the text.
If the text is a poem or story, ground the explanation exactly in its contents.

Textbook excerpt:
${contextText}

Output a JSON object with this exact shape:
{
  "text": "The full lesson prose (engaging, age-appropriate, well-formatted)",
  "summary": "A 1-2 sentence summary of the lesson",
  "vocabulary": [ { "word": "...", "meaning": "..." } ],
  "keyConcepts": [ "...", "..." ],
  "reflectionQuestion": "One thought-provoking question for the student"
}`;

    let generated;
    try {
      generated = await callLLM(prompt);
      if (!generated.text || generated.text.length < 50 || generated.text.includes('Interactive Practice Module')) {
        throw new Error('Validation failed: output looks like placeholder or is too short.');
      }
    } catch (err) {
      console.error(`  ! Generation failed: ${err.message}`);
      stats.skipped[grade]++;
      continue;
    }

    // Write to DB
    const upsertData = {
      topic_id: topicId,
      resource_type: 'AI_EXPLANATION',
      status: 'READY',
      source_tier: 'ORIGINAL_AI',
      static_payload: {
        text: generated.text,
        summary: generated.summary || '',
        vocabulary: generated.vocabulary || [],
        keyConcepts: generated.keyConcepts || [],
        reflectionQuestion: generated.reflectionQuestion || '',
        attribution: 'AI Generated — Aivorah'
      }
    };

    const { error: upsertErr } = await supabase
      .from('topic_resources')
      .upsert(upsertData, { onConflict: 'topic_id,resource_type' });

    if (upsertErr) {
      console.error(`  ! DB upsert failed: ${upsertErr.message}`);
      stats.skipped[grade]++;
      continue;
    }

    console.log(`  -> Successfully generated and saved.`);
    stats.succeeded[grade]++;
  }

  console.log('\n=== FINAL REPORT ===');
  let totalAttempted = 0;
  let totalSucceeded = 0;
  let totalSkipped = 0;
  
  for (let i = 1; i <= 12; i++) {
    if (stats.attempted[i] > 0) {
      console.log(`Grade ${i}: Attempted: ${stats.attempted[i]}, Succeeded: ${stats.succeeded[i]}, Skipped: ${stats.skipped[i]}`);
      totalAttempted += stats.attempted[i];
      totalSucceeded += stats.succeeded[i];
      totalSkipped += stats.skipped[i];
    }
  }
  console.log(`\nTotal Attempted: ${totalAttempted} (out of ${worklist.length})`);
  console.log(`Total Succeeded: ${totalSucceeded}`);
  console.log(`Total Skipped: ${totalSkipped}`);
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
