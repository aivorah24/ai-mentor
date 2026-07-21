/**
 * Content Mapping stage — for a given topic, look for a matched learning
 * source (a licensed textbook or approved OER) whose actual content has been
 * extracted and published — before falling back to AI generation. This
 * queries curriculum_sources, which starts empty for every curriculum and is
 * only ever populated by an explicit registration call (registerSource
 * below) — never fabricated, never guessed.
 *
 * IMPORTANT: a source that is merely REGISTERED (e.g. "Cambridge University
 * Press publishes an endorsed textbook for this subject/grade" — a reference
 * to a prescribed/endorsed publisher, with no actual file uploaded yet) is
 * NOT treated as a usable match here. Only status === 'INGESTED' — meaning
 * real extracted text has actually been published for it via
 * ingestionService.js — counts as "found." Matching on REGISTERED alone
 * would mark BOOK_REFERENCE/AI_EXPLANATION READY for content nobody has
 * actually ingested, which is exactly the fabrication this pipeline must
 * never do. Publisher/endorsed-resource NAMES by themselves (e.g. from the
 * ICSE Prescribed Textbooks appendix, or Cambridge's endorsed-resource list)
 * are useful as REGISTERED bookkeeping — "we know this book exists and is
 * the right one to eventually license/ingest" — but produce no student-
 * facing content until someone actually supplies and extracts that text.
 *
 * "Matching" here is scope-based (curriculum + grade + subject), not
 * per-topic semantic matching — an ingested source for a scope is assumed
 * to cover its syllabus's topics. Topic-level granularity comes from
 * whichever extraction/ingestion pipeline processed that source.
 */
const supabase = require('../supabase');

/**
 * @param {{ curriculum: string, grade: string, subject: string }} args
 * @returns {Promise<{id:string, sourceType:'LICENSED_TEXTBOOK'|'OER', title:string, license:string|null, url:string|null}|null>}
 *   null when no INGESTED matched source exists — caller must fall back to AI enrichment.
 */
async function findMatchedSource({ curriculum, grade, subject }) {
  const { data, error } = await supabase
    .from('curriculum_sources')
    .select('id, source_type, title, license, url')
    .eq('curriculum', curriculum)
    .eq('grade', grade)
    .eq('subject', subject)
    .in('source_type', ['LICENSED_TEXTBOOK', 'OER'])
    .eq('status', 'INGESTED')
    .order('ingested_at', { ascending: false })
    .limit(1);

  if (error || !data || data.length === 0) return null;
  const s = data[0];
  return { id: s.id, sourceType: s.source_type, title: s.title, license: s.license, url: s.url };
}

/**
 * Lists sources that are known/registered for a scope but not yet ingested
 * — i.e. "we know these publishers/resources exist and are the right ones
 * to license/ingest eventually" (e.g. entries from the ICSE Prescribed
 * Textbooks appendix or Cambridge's endorsed-resource list, registered by
 * name/reference only). Surfaced to the Teacher Preview stage as context —
 * never used to mark a resource READY.
 * @param {{ curriculum: string, grade: string, subject: string }} args
 */
async function listPendingSources({ curriculum, grade, subject }) {
  const { data } = await supabase
    .from('curriculum_sources')
    .select('id, source_type, title, license, url')
    .eq('curriculum', curriculum)
    .eq('grade', grade)
    .eq('subject', subject)
    .in('source_type', ['LICENSED_TEXTBOOK', 'OER'])
    .eq('status', 'REGISTERED')
    .order('registered_at', { ascending: false });
  return data || [];
}

/**
 * Registers a source document (official syllabus, licensed textbook, or OER)
 * for a curriculum scope. Does not ingest/extract anything — pure bookkeeping,
 * the "registration mechanism" step so a real document can be marked known
 * before or independently of running extraction on it.
 * @param {{ curriculum:string, grade:string, subject?:string, sourceType: 'OFFICIAL_SYLLABUS'|'LICENSED_TEXTBOOK'|'OER'|'AI_GENERATED', title:string, fileHash?:string, url?:string, license?:string, registeredBy?:string }} args
 */
async function registerSource({ curriculum, grade, subject, sourceType, title, fileHash, url, license, registeredBy }) {
  const { data, error } = await supabase
    .from('curriculum_sources')
    .insert({
      curriculum, grade, subject: subject || null, source_type: sourceType, title,
      file_hash: fileHash || null, url: url || null, license: license || null,
      registered_by: registeredBy || null,
    })
    .select('id')
    .single();
  if (error) throw new Error(error.message);
  return data.id;
}

async function markSourceIngested(sourceId) {
  await supabase.from('curriculum_sources').update({ status: 'INGESTED', ingested_at: new Date().toISOString() }).eq('id', sourceId);
}

module.exports = { findMatchedSource, listPendingSources, registerSource, markSourceIngested };
