const cheerio = require("cheerio-without-node-native");
const { HEADERS, cleanTitle, titleSimilarity, timeoutSignal, warn } = require("../../shared/constants");
const { extractJsonAssignment } = require("./constants");

async function searchMultimovies(mirror, query) {
  try {
    const res = await fetch(
      `${mirror}/search?q=${encodeURIComponent(query)}`,
      { headers: HEADERS, signal: timeoutSignal(10000) }
    );
    if (!res || !res.ok) return [];
    const html = await res.text();
    const $ = cheerio.load(html);
    const out = [];
    const seen = new Set();
    $("a").each((_, el) => {
      const href = $(el).attr("href") || "";
      if (!(href.indexOf("/movie/") === 0 || href.indexOf("/series/") === 0)) return;
      const clean = href.split("#")[0].split("?")[0];
      if (seen.has(clean)) return;
      const title = $(el).attr("aria-label") || $(el).attr("title") || $(el).text().trim();
      if (!title) return;
      seen.add(clean);
      out.push({ title: title.trim(), href: `${mirror}${clean}` });
    });
    return out;
  } catch (e) {
    warn("search", e);
    return [];
  }
}

async function findBestMatch(mirror, details, mediaType) {
  if (!details || !details.title) return null;

  const queries = [];
  const qSeen = new Set();
  const pushQ = (q) => {
    if (!q) return;
    const k = q.toLowerCase();
    if (qSeen.has(k)) return;
    qSeen.add(k);
    queries.push(q);
  };
  pushQ(details.title);
  pushQ(cleanTitle(details.title));
  (details.aliases || []).slice(0, 3).forEach((a) => { pushQ(a); pushQ(cleanTitle(a)); });

  let all = [];
  for (const q of queries) {
    const r = await searchMultimovies(mirror, q);
    if (r && r.length) { all = r; break; }
  }
  if (!all.length) return null;

  let best = null;
  let bestScore = -1;
  for (const item of all) {
    let score = titleSimilarity(details.title, item.title);
    if (score < 0.9 && details.aliases) {
      for (const alias of details.aliases) {
        const s2 = titleSimilarity(alias, item.title);
        if (s2 > score) score = s2;
      }
    }
    if (mediaType === "movie") {
      if (item.href.indexOf("/movie/") !== -1) score += 0.15;
      if (item.href.indexOf("/series/") !== -1) score -= 0.1;
    } else if (mediaType === "tv") {
      if (item.href.indexOf("/series/") !== -1) score += 0.15;
      if (item.href.indexOf("/movie/") !== -1) score -= 0.1;
    }
    if (score > bestScore) { bestScore = score; best = item; }
  }
  return best || all[0];
}

function buildEpisodeUrl(seriesUrl, season, episode) {
  const clean = seriesUrl.replace(/\/+$/, "");
  return `${clean}/season/${season}/episode/${episode}`;
}

async function fetchWatchConfig(pageUrl) {
  try {
    const res = await fetch(pageUrl, { headers: HEADERS, signal: timeoutSignal(12000) });
    if (!res || !res.ok) return null;
    const html = await res.text();
    return extractJsonAssignment(html, "watchConfig");
  } catch (e) {
    warn("fetchWatchConfig", e);
    return null;
  }
}

module.exports = {
  searchMultimovies,
  findBestMatch,
  buildEpisodeUrl,
  fetchWatchConfig
};
