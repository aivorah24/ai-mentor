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

// ── Web image fallback: fetch safe, educational images from Wikipedia ──
// Used when Qdrant has no relevant book images for the topic.
// IMPORTANT: Children (Grade 3–5, ages 8–11) use this — every image must be
// simple, clear, colourful, and directly relevant. No graphs, charts, data
// plots, technical diagrams, microscopy, or anything a child can't understand
// at a glance. When in doubt, show NO image rather than a confusing one.
async function retrieveWebImages({ question, topic, subject, grade, maxImages = 2 }) {
  const query = (topic || question || '').trim();
  if (!query) return [];

  // Extract grade number for age-appropriate filtering
  const gradeNum = parseInt(String(grade || '').replace(/\D/g, ''), 10) || 0;
  const isYoungChild = gradeNum >= 1 && gradeNum <= 5;

  try {
    // 1. Search Wikipedia for the topic — use the topic name directly
    //    Adding extra words like "for kids" or "diagram" pollutes the search
    //    and returns unrelated articles. Keep the query clean.
    const searchUrl = new URL(WIKI_SEARCH_API);
    searchUrl.searchParams.set('action', 'query');
    searchUrl.searchParams.set('list', 'search');
    searchUrl.searchParams.set('format', 'json');
    searchUrl.searchParams.set('utf8', '1');
    searchUrl.searchParams.set('srlimit', '1');
    searchUrl.searchParams.set('srsearch', query);

    const searchRes = await fetch(searchUrl.toString(), {
      headers: { 'User-Agent': 'Aivorah-AI-Coach/1.0' },
    });
    if (!searchRes.ok) return [];
    const searchJson = await searchRes.json();
    const title = searchJson?.query?.search?.[0]?.title;
    if (!title) return [];

    // 2. Get images from the Wikipedia article
    const imgUrl = new URL(WIKI_SEARCH_API);
    imgUrl.searchParams.set('action', 'query');
    imgUrl.searchParams.set('titles', title);
    imgUrl.searchParams.set('prop', 'images');
    imgUrl.searchParams.set('format', 'json');
    imgUrl.searchParams.set('imlimit', '20');

    const imgRes = await fetch(imgUrl.toString(), {
      headers: { 'User-Agent': 'Aivorah-AI-Coach/1.0' },
    });
    if (!imgRes.ok) return [];
    const imgJson = await imgRes.json();

    // ── Filename blocklists ──
    // UI/template junk + portraits/people photos
    const JUNK_RE = /icon|logo|flag|commons|edit|button|arrow|wiki|symbol|cscr|lock|replace|stub|disambig|portal|question_book|unbalanced|merge|ambox|text-|padlock|template|info[-_]?box|navbar|wiktionary|wikiquote|wikisource|wikimedia|portrait|painting|statue|bust|metro.?map|metabolic|semi.?protect|shackle/i;
    // Unsafe / inappropriate for children
    const UNSAFE_RE = /dissect|surg|blood|injur|dead|skull|weapon|nude|naked|reproductive|genital|violence|murder|autopsy|corpse|drug|alcohol|tobacco|cigarette|sex/i;
    // Scientific/technical images a child won't understand
    const TECHNICAL_RE = /spectr|molecul|crystal|structur|microscop|electron|formula|equation|graph\b|chart\b|histogram|dewpoint|isotherm|phase.?diagram|scatter.?plot|regression|logarithm|data.?table|cross.?section|thin.?section|xrd|sem\b|tem\b|nmr\b|infrared|ultraviolet|x-ray|chromatogra|electrophores|karyotype|genome|dna.?gel|protein.?struct|cell.?cycle|mitosis.?stage|taxonomy|phylogen|cladogram|dendrogram|chloroplast|thylakoid|pathway|hatch.?slack|calvin|krebs|citric|stroma|granum|scheme.*of|diagram.*of.*cell|cross.*section/i;

    const pages = imgJson?.query?.pages || {};
    const imageNames = [];
    for (const page of Object.values(pages)) {
      for (const img of (page.images || [])) {
        const name = img.title || '';
        if (/\.(jpg|jpeg|png|svg)$/i.test(name) &&
            !JUNK_RE.test(name) &&
            !UNSAFE_RE.test(name) &&
            !TECHNICAL_RE.test(name)) {
          imageNames.push(name);
        }
      }
    }

    if (imageNames.length === 0) return [];

    // 3. Get actual image URLs + metadata (fetch a few extra for filtering)
    const selected = imageNames.slice(0, maxImages + 4);
    const infoUrl = new URL(WIKI_SEARCH_API);
    infoUrl.searchParams.set('action', 'query');
    infoUrl.searchParams.set('titles', selected.join('|'));
    infoUrl.searchParams.set('prop', 'imageinfo');
    infoUrl.searchParams.set('iiprop', 'url|extmetadata|size');
    infoUrl.searchParams.set('iiurlwidth', '400');
    infoUrl.searchParams.set('format', 'json');

    const infoRes = await fetch(infoUrl.toString(), {
      headers: { 'User-Agent': 'Aivorah-AI-Coach/1.0' },
    });
    if (!infoRes.ok) return [];
    const infoJson = await infoRes.json();

    const results = [];
    const infoPages = infoJson?.query?.pages || {};
    for (const page of Object.values(infoPages)) {
      const info = page?.imageinfo?.[0];
      if (!info) continue;
      const thumbUrl = info.thumburl || info.url;
      if (!thumbUrl) continue;

      // Skip tiny images (likely icons) or SVGs that are just diagrams
      const width = info.width || 0;
      const height = info.height || 0;
      if (width < 150 || height < 100) continue;

      // Get description from metadata
      const desc = info.extmetadata?.ImageDescription?.value || '';
      const cleanDesc = stripHtml(desc).slice(0, 120);
      const rawCaption = cleanDesc || page.title?.replace('File:', '').replace(/\.\w+$/, '').replace(/_/g, ' ') || '';

      // Skip images whose captions/descriptions contain technical or unsafe terms
      if (TECHNICAL_RE.test(rawCaption) || UNSAFE_RE.test(rawCaption)) continue;
      if (TECHNICAL_RE.test(thumbUrl) || UNSAFE_RE.test(thumbUrl)) continue;

      // For young children: skip anything that sounds like a data visualization or technical content
      if (isYoungChild) {
        const captionLower = rawCaption.toLowerCase();
        if (/\b(plot|axis|data|percent|ratio|coefficient|parameter|variable|regression|correlation|humidity|dewpoint|pressure|temperature.*(graph|chart|plot)|vs\.?\s)/i.test(captionLower)) continue;
        if (/template|for\s+.*\s+related/i.test(captionLower)) continue;
        // Skip SVG code descriptions, cloud chambers, lab equipment, etc.
        if (/svg file|code for|cloud chamber|isopropanol|apparatus|laboratory|experiment setup/i.test(captionLower)) continue;
        // Skip "Scheme of..." or "Diagram of..." — typically technical cross-sections
        if (/^(scheme|diagram|cross.?section|structure|anatomy)\s+(of|showing)/i.test(captionLower)) continue;
      }

      results.push({
        url: thumbUrl,
        caption: rawCaption,
        subject: subject || '',
        grade: '',
        topic: topic || query,
        source: 'wikipedia',
      });
    }

    // Final child-safety filter on captions + URLs
    const ADVANCED_TERMS = /calvin cycle|spectr|molecul|absorption|wavelength|electron|mitochond|cytoplasm|adenosine|rubisco|atp|nadph|chloroplast ultrastructure|taxonomy|phylogen|krebs|citric acid cycle|oxidative phosphorylation|thylakoid|stroma|granum/i;
    let kidFriendly = results.filter((r) => !ADVANCED_TERMS.test(r.caption) && !ADVANCED_TERMS.test(r.url));

    // Caption relevance check: the image caption should relate to the topic.
    // Extract key words from the query and require at least one to appear in the caption.
    const queryWords = query.toLowerCase().split(/\s+/).filter(w => w.length >= 4);
    if (queryWords.length > 0) {
      const relevant = kidFriendly.filter((r) => {
        const cap = (r.caption || '').toLowerCase();
        // At least one query keyword must appear in caption or the caption must be very short (like "A leaf")
        return queryWords.some(w => cap.includes(w)) || cap.length <= 20;
      });
      // Only use relevance-filtered if we have results; otherwise skip images entirely
      kidFriendly = relevant;
    }

    // For young children, only return images if we have genuinely good ones
    if (isYoungChild && kidFriendly.length === 0) return [];

    return kidFriendly.slice(0, maxImages);
  } catch (err) {
    console.warn('[retrieveWebImages] Wikipedia image fetch failed:', err.message);
    return [];
  }
}

module.exports = {
  retrieveWebContext,
  retrieveWebImages,
  buildCurriculumSearchQuery,
};
