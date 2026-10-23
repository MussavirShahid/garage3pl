// Best-effort product image lookup.
//
// Default provider is Openverse (https://openverse.org) — free, no API key,
// returns openly-licensed images. It will not always have an exact match for a
// specific retail SKU, so results are treated as SUGGESTIONS the user confirms
// or replaces. For stronger product matches, set one of these and it is used first:
//   SERPAPI_KEY                         (https://serpapi.com Google Images)
//   GOOGLE_CSE_KEY + GOOGLE_CSE_CX      (Google Programmable Search, image mode)

async function openverse(query, limit) {
  const u = `https://api.openverse.org/v1/images/?q=${encodeURIComponent(query)}&page_size=${limit}`;
  const res = await fetch(u, { headers: { 'User-Agent': 'garage3pl/0.1 (self-hosted)' } });
  if (!res.ok) throw new Error(`openverse ${res.status}`);
  const j = await res.json();
  return (j.results || []).map((r) => ({
    url: r.url,
    thumbnail: r.thumbnail || r.url,
    source: r.foreign_landing_url || 'openverse.org',
    title: r.title || '',
    provider: 'openverse',
  }));
}

async function serpapi(query, limit) {
  const key = process.env.SERPAPI_KEY;
  const u = `https://serpapi.com/search.json?engine=google_images&q=${encodeURIComponent(query)}&num=${limit}&api_key=${key}`;
  const res = await fetch(u);
  if (!res.ok) throw new Error(`serpapi ${res.status}`);
  const j = await res.json();
  return (j.images_results || []).slice(0, limit).map((r) => ({
    url: r.original || r.thumbnail,
    thumbnail: r.thumbnail || r.original,
    source: r.link || r.source || 'google',
    title: r.title || '',
    provider: 'serpapi',
  }));
}

async function googleCse(query, limit) {
  const key = process.env.GOOGLE_CSE_KEY;
  const cx = process.env.GOOGLE_CSE_CX;
  const u = `https://www.googleapis.com/customsearch/v1?key=${key}&cx=${cx}&searchType=image&num=${Math.min(limit, 10)}&q=${encodeURIComponent(query)}`;
  const res = await fetch(u);
  if (!res.ok) throw new Error(`google-cse ${res.status}`);
  const j = await res.json();
  return (j.items || []).map((r) => ({
    url: r.link,
    thumbnail: (r.image && r.image.thumbnailLink) || r.link,
    source: (r.image && r.image.contextLink) || 'google',
    title: r.title || '',
    provider: 'google-cse',
  }));
}

// Image engines match on plain product words. SKUs ("MUG-BLU-12"), sizes
// ("12oz", "A5") and bare numbers return nothing, so strip them and, if a query
// still finds nothing, retry with progressively fewer words.
const UNIT_RE = /^\d+([.,]\d+)?(oz|ml|l|g|kg|lb|lbs|cm|mm|m|in|inch|ft|pk|pack|ct|pcs?|pc|x)?$/i;
function simplify(name) {
  const words = String(name || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .filter((w) => !UNIT_RE.test(w))              // 12oz, 8, 160
    .filter((w) => !/^[a-z]\d+$/.test(w))         // a5, xl2
    .filter((w) => !(/\d/.test(w) && /-/.test(w))) // sku-like: mug-blu-12
    .filter((w) => !/^\d+$/.test(w));
  return words;
}
function candidates(query) {
  const words = simplify(query);
  const out = [];
  if (words.length) out.push(words.join(' '));
  if (words.length > 3) out.push(words.slice(0, 3).join(' '));
  if (words.length > 2) out.push(words.slice(0, 2).join(' '));
  const raw = String(query || '').trim();
  if (raw && !out.includes(raw.toLowerCase())) out.push(raw); // last resort: as typed
  return [...new Set(out)];
}

const TIMEOUT_MS = 10000;

// Returns { query, results }: the query that actually produced results, and
// the candidate images. Never throws; empty results mean "nothing found".
export async function findImages(query, { limit = 6 } = {}) {
  const providers = [];
  if (process.env.SERPAPI_KEY) providers.push(serpapi);
  if (process.env.GOOGLE_CSE_KEY && process.env.GOOGLE_CSE_CX) providers.push(googleCse);
  providers.push(openverse); // keyless fallback always last

  const tries = candidates(query);
  for (const p of providers) {
    for (const q of tries) {
      try {
        const r = await withTimeout(p(q, limit), TIMEOUT_MS);
        if (r && r.length) return { query: q, results: r };
      } catch (err) {
        console.warn(`[images] ${p.name}("${q}") failed:`, err.message);
      }
    }
  }
  return { query: tries[0] || String(query || ''), results: [] };
}

function withTimeout(promise, ms) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`timed out after ${ms}ms`)), ms);
    promise.then((v) => { clearTimeout(t); resolve(v); }, (e) => { clearTimeout(t); reject(e); });
  });
}
