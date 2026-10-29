const cheerio = require("cheerio-without-node-native");
const { HEADERS, cleanTitle, titleSimilarity, joinUrl, warn } = require("../../shared/constants");
const { MAIN_URL } = require("./constants");

function parseResults($, selector) {
  const out = [];
  $(selector).each((_, el) => {
    const title = $(el).find("h2.entry-title, header h2, .entry-title").first().text().trim();
    const href = $(el).find("a.lnk-blk").attr("href") || $(el).find("a").first().attr("href");
    if (title && href) {
      out.push({ title, href: joinUrl(MAIN_URL, href) });
    }
  });
  return out;
}

async function searchDirect(query) {
  try {
    const url = `${MAIN_URL}/?s=${encodeURIComponent(query)}`;
    const res = await fetch(url, { headers: HEADERS });
    if (!res.ok) return [];
    const html = await res.text();
    const $ = cheerio.load(html);
    return parseResults($, "article.post, li.hentry");
  } catch (e) {
    warn("search:direct", e);
    return [];
  }
}

async function searchAjax(query) {
  try {
    const body = `action=torofilm_infinite_scroll&page=1&per_page=16&query_type=search&query_args[s]=${encodeURIComponent(query)}`;
    const res = await fetch(`${MAIN_URL}/wp-admin/admin-ajax.php`, {
      method: "POST",
      headers: {
        ...HEADERS,
        "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
        "X-Requested-With": "XMLHttpRequest",
        "Referer": `${MAIN_URL}/`
      },
      body
    });
    if (!res.ok) return [];
    const json = await res.json();
    if (!json || !json.success || !json.data || !json.data.content) return [];
    const $ = cheerio.load(json.data.content);
    return parseResults($, "article, li");
  } catch (e) {
    warn("search:ajax", e);
    return [];
  }
}

async function searchAnimeSalt(query) {
  const direct = await searchDirect(query);
  if (direct.length > 0) return direct;
  return searchAjax(query);
}

async function tryQueries(queries) {
  for (const q of queries) {
    if (!q) continue;
    const res = await searchAnimeSalt(q);
    if (res.length > 0) return res;
  }
  return [];
}

async function findBestMatch(tmdbDetails, mediaType) {
  if (!tmdbDetails || !tmdbDetails.title) return null;

  const seen = new Set();
  const queries = [];
  const push = (q) => {
    if (!q) return;
    const key = q.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    queries.push(q);
  };
  push(tmdbDetails.title);
  push(cleanTitle(tmdbDetails.title));
  for (const alias of (tmdbDetails.aliases || []).slice(0, 3)) {
    push(alias);
    push(cleanTitle(alias));
  }

  const allResults = await tryQueries(queries);
  if (allResults.length === 0) return null;

  const unique = [];
  const seenHrefs = new Set();
  for (const item of allResults) {
    if (item.href && !seenHrefs.has(item.href)) {
      seenHrefs.add(item.href);
      unique.push(item);
    }
  }

  let bestMatch = null;
  let highestScore = -1;

  for (const item of unique) {
    let score = titleSimilarity(tmdbDetails.title, item.title);
    if (score < 0.9 && tmdbDetails.aliases && tmdbDetails.aliases.length) {
      for (const alias of tmdbDetails.aliases) {
        const aliasScore = titleSimilarity(alias, item.title);
        if (aliasScore > score) score = aliasScore;
      }
    }
    if (mediaType === "movie") {
      if (item.href.includes("/movies/")) score += 0.15;
      if (item.href.includes("/series/")) score -= 0.1;
    } else if (mediaType === "tv") {
      if (item.href.includes("/series/")) score += 0.15;
      if (item.href.includes("/movies/")) score -= 0.1;
    }
    if (score > highestScore) {
      highestScore = score;
      bestMatch = item;
    }
  }

  return bestMatch || unique[0];
}

module.exports = {
  searchAnimeSalt,
  findBestMatch
};
