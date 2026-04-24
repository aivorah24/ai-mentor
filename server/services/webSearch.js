const WIKI_SEARCH_API = 'https://en.wikipedia.org/w/api.php';

function stripHtml(text) {
  return String(text || '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function buildCurriculumSearchQuery({ question, curriculum, grade, subject, topic }) {
  const parts = [
    topic,
    question,
    subject,
    grade,
    curriculum ? String(curriculum).replace(/_/g, ' ') : '',
    'for school students',
  ].filter(Boolean);
  return parts.join(' ');
}

async function searchWikipediaSources(query, limit = 3) {
  const url = new URL(WIKI_SEARCH_API);
  url.searchParams.set('action', 'query');
  url.searchParams.set('list', 'search');
  url.searchParams.set('format', 'json');
  url.searchParams.set('utf8', '1');
  url.searchParams.set('srlimit', String(limit));
  url.searchParams.set('srsearch', query);

  const searchRes = await fetch(url.toString(), {
    headers: { 'User-Agent': 'Aivorah-AI-Coach/1.0' },
  });
  if (!searchRes.ok) return [];

  const searchJson = await searchRes.json();
  const items = (searchJson?.query?.search || []).slice(0, limit);
  const out = [];

  for (const item of items) {
    const title = String(item?.title || '').trim();
    if (!title) continue;
    const summaryUrl = `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title)}`;
    try {
      const summaryRes = await fetch(summaryUrl, {
        headers: { 'User-Agent': 'Aivorah-AI-Coach/1.0' },
      });
      if (!summaryRes.ok) continue;

      const summaryJson = await summaryRes.json();
      const extract = stripHtml(summaryJson?.extract || item?.snippet || '');
      if (!extract) continue;

      out.push({
        title,
        url:
          summaryJson?.content_urls?.desktop?.page ||
          `https://en.wikipedia.org/wiki/${encodeURIComponent(title.replace(/ /g, '_'))}`,
        snippet: extract,
      });
    } catch (_) {}
  }

  return out;
}

function buildWebContext(hits) {
  return hits
    .map((h) => `[Web > Wikipedia > ${h.title}]\n${h.snippet}`)
    .join('\n\n---\n\n');
}

function buildWebSources(hits) {
  return hits.map((h) => ({
    subject: 'Web',
    unit: 'Wikipedia',
    topic: h.title,
    score: 0.5,
    url: h.url,
  }));
}

async function retrieveWebContext({ question, curriculum, grade, subject, topic }) {
  const enabled = String(process.env.WEB_SEARCH_FALLBACK || 'true').toLowerCase() !== 'false';
  if (!enabled) {
    return {
      context: '',
      sources: [],
      meta: { enabled: false, query: '', count: 0 },
    };
  }

  const query = buildCurriculumSearchQuery({ question, curriculum, grade, subject, topic });
  const hits = await searchWikipediaSources(query, 3);

  return {
    context: buildWebContext(hits),
    sources: buildWebSources(hits),
    meta: { enabled: true, query, count: hits.length },
  };
}

module.exports = {
  retrieveWebContext,
  buildCurriculumSearchQuery,
};
