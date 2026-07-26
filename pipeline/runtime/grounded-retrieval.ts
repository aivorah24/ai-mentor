// Grounded Retrieval — the REAL retrieval step.
//
// The Retrieval agent must never invent textbook content. The LLM-only runtime
// made it hallucinate NCERT text from memory (that's why "My Bicycle" came out
// as a word-list). This module instead performs an actual vector search against
// the same Qdrant the app uses, and emits a RetrievalPackage (contracts.md §3)
// containing only real, retrieved chunks. If nothing is ingested for the
// request, it returns zero chunks with a warning — never fabricated text.
//
// Reuses the server's own embedding + search services (CJS) so the pipeline and
// the live app ground on identical data.
const path = require('path');
// Load env BEFORE requiring the server services — qdrant.js constructs its
// client from process.env at require-time, and ES import hoisting runs this
// module before the orchestrator's own dotenv.config(). Without this the client
// is built with an undefined QDRANT_URL and every search silently returns 0.
require('dotenv').config({ path: path.resolve(__dirname, '../../.env') });
const SERVER = path.resolve(__dirname, '../../server');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { embed } = require(path.join(SERVER, 'services/embeddings'));
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { searchGrounding } = require(path.join(SERVER, 'services/qdrant'));

type RetrievalRequest = {
  grade: number | string;
  subject: string;
  chapter?: string;
  unit?: number | string;
  lesson?: string;
  lesson_id?: string;
  curriculum?: string;
};

function uuid(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}

export async function groundedRetrieve(input: any, pipelineId: string): Promise<any> {
  const req: RetrievalRequest = input?.request || input || {};
  const grade = req.grade;
  const subject = req.subject;
  const lesson = req.lesson || req.chapter || '';
  const curriculum = req.curriculum || 'NCERT';

  // Query blends lesson + subject so the vector search lands on the right chunks.
  const queryText = `${lesson} ${subject} grade ${grade}`.trim();
  const vector = await embed(queryText);

  // NOTE: do NOT pass `topic` — it isn't a Qdrant payload index, so filtering on
  // it throws a Bad Request that searchGrounding swallows → 0 results. Vector
  // similarity on the query text already ranks by topic relevance.
  const { chunks, source } = await searchGrounding({
    vector,
    curriculum,
    grade,
    subject,
    limit: 8,
  });

  // Keep the payload small enough to fit downstream agents within Groq's 6000
  // tokens/minute free-tier budget: cap to the top chunks and trim each chunk's
  // text. Every chunk here is still REAL retrieved NCERT content — we're limiting
  // volume, never fabricating.
  const MAX_CHUNKS = 5;
  const MAX_CHARS = 450;
  const retrieved = (chunks || []).slice(0, MAX_CHUNKS).map((c: any, i: number) => {
    const pl = c.payload || {};
    const text = String(pl.text || pl.content || '');
    return {
      chunk_id: String(c.id ?? `chunk_${i}`),
      page_number: pl.page ?? pl.page_number ?? null,
      section: pl.section || pl.content_type || pl.type || 'text',
      order: pl.chunk_index ?? i,
      content: text.length > MAX_CHARS ? text.slice(0, MAX_CHARS) + '…' : text,
      embedding_score: c.score ?? null,
      metadata: {
        grade: pl.grade, subject: pl.subject, topic: pl.topic,
        curriculum: pl.curriculum,
      },
    };
  });

  const warnings: string[] = [];
  if (retrieved.length === 0) {
    warnings.push(`NO_CONTENT_INGESTED: nothing found in Qdrant for grade=${grade} subject=${subject} lesson="${lesson}". Downstream agents MUST NOT fabricate textbook content.`);
  }

  return {
    package: {
      package_id: uuid(),
      package_type: 'RetrievalPackage',
      schema_version: '1.0',
      created_at: new Date().toISOString(),
      produced_by: { agent: 'grounded-retrieval', version: '1.0.0' },
      trace: { pipeline_id: pipelineId, parent_package_id: null },
    },
    payload: {
      request: {
        grade, subject, chapter: req.chapter || lesson,
        lesson_id: req.lesson_id || '', lesson,
      },
      retrieval_summary: {
        confidence: retrieved.length > 0 ? (retrieved[0].embedding_score ?? 0) : 0,
        coverage: retrieved.length > 0 ? 1 : 0,
        chunks_retrieved: retrieved.length,
        collection_source: source || null,
      },
      retrieved_chunks: retrieved,
      source_metadata: source ? [JSON.stringify(source)] : [],
      warnings,
      handoff: {
        curriculum_understanding_agent: {
          ordered_chunks: retrieved.map((r: any) => r.chunk_id),
          retrieval_summary: { chunks_retrieved: retrieved.length },
          source_metadata: source ? [JSON.stringify(source)] : [],
          warnings,
        },
      },
    },
  };
}
