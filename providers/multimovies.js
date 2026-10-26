/**
 * MultiMovies Nuvio Scraper Plugin
 * Compatible with Nuvio App (Mobile & Android TV) and All-in-One-Nuvio
 * Source: https://multimovies.wtf/ (resolves to current mirror, default https://m1.multimovies.courses)
 */

var cheerio = typeof require !== "undefined"
  ? require("cheerio-without-node-native")
  : (globalThis.cheerio || {});

/* ──────────────────────────────────────────────────────────────────────── *
 *  Constants
 * ──────────────────────────────────────────────────────────────────────── */

var DOMAIN_RESOLVER = "https://multimovies.wtf/";
var DEFAULT_MIRROR = "https://m1.multimovies.courses";
// Short in-memory cache for the resolved mirror. Multimovies rotates domains
// — we re-check at most every 30 minutes rather than every scrape.
var MIRROR_CACHE = { url: null, exp: 0 };
var MIRROR_TTL_MS = 30 * 60 * 1000;

var TMDB_BASE_URL = "https://api.themoviedb.org/3";
var DEFAULT_TMDB_KEY = "1865f43a0549ca50d341dd9ab8b29f49";
var USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36";
var HEADERS = {
  "User-Agent": USER_AGENT,
  "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "Accept-Language": "en-US,en;q=0.9"
};

var VIDOUT_GITHUB_BASE =
  "https://raw.githubusercontent.com/Watchout2025/api/refs/heads/main";

var QUALITY_ORDER = { "4K": 6, "1440p": 5, "1080p": 4, "720p": 3, "480p": 2, "360p": 1, "Auto": 0 };

/* ──────────────────────────────────────────────────────────────────────── *
 *  Logging — silent unless NUVIO_DEBUG is set.
 * ──────────────────────────────────────────────────────────────────────── */

function warn(context, err) {
  var dbg = typeof globalThis !== "undefined" && globalThis.NUVIO_DEBUG === true;
  if (!dbg) return;
  if (typeof console === "undefined" || typeof console.warn !== "function") return;
  var msg = err && err.message ? err.message : String(err);
  console.warn("[nuvio:multimovies:" + context + "] " + msg);
}

/* ──────────────────────────────────────────────────────────────────────── *
 *  Helpers
 * ──────────────────────────────────────────────────────────────────────── */

function timeoutSignal(ms) {
  try {
    if (typeof AbortSignal !== "undefined" && AbortSignal.timeout) {
      return AbortSignal.timeout(ms);
    }
  } catch (e) { /* ignore */ }
  return undefined;
}

function cleanTitle(str) {
  return (str || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function titleSimilarity(a, b) {
  var cleanA = cleanTitle(a);
  var cleanB = cleanTitle(b);
  if (!cleanA || !cleanB) return 0;
  if (cleanA === cleanB) return 1;
  if (cleanA.indexOf(cleanB) !== -1 || cleanB.indexOf(cleanA) !== -1) return 0.8;
  var wordsA = new Set(cleanA.split(" "));
  var wordsB = new Set(cleanB.split(" "));
  var intersection = 0;
  wordsA.forEach(function (w) { if (wordsB.has(w)) intersection++; });
  return (intersection * 2) / (wordsA.size + wordsB.size);
}

function validateEpisodeInput(seasonNum, episodeNum) {
  var s = Number(seasonNum);
  var e = Number(episodeNum);
  if (!Number.isInteger(s) || s < 1 || s > 9999) return null;
  if (!Number.isInteger(e) || e < 1 || e > 9999) return null;
  return { season: s, episode: e };
}

function heightToQuality(height) {
  if (!Number.isFinite(height) || height <= 0) return "Auto";
  if (height >= 2160) return "4K";
  if (height >= 1440) return "1440p";
  if (height >= 1080) return "1080p";
  if (height >= 720) return "720p";
  if (height >= 480) return "480p";
  if (height >= 360) return "360p";
  if (height >= 240) return "240p";
  return "144p";
}

// Extract the top-level JSON object that follows `needle = ` in a script
// blob — matches balanced braces so we don't need a monster regex.
function extractJsonAssignment(html, needle) {
  var i = html.indexOf(needle);
  if (i === -1) return null;
  var start = html.indexOf("{", i);
  if (start === -1) return null;
  var depth = 0;
  var inStr = false;
  var strCh = "";
  var escape = false;
  for (var j = start; j < html.length; j++) {
    var ch = html[j];
    if (inStr) {
      if (escape) { escape = false; continue; }
      if (ch === "\\") { escape = true; continue; }
      if (ch === strCh) { inStr = false; }
      continue;
    }
    if (ch === '"' || ch === "'") { inStr = true; strCh = ch; continue; }
    if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) {
        try { return JSON.parse(html.substring(start, j + 1)); }
        catch (e) { warn("extractJson:" + needle, e); return null; }
      }
    }
  }
  return null;
}

/* ──────────────────────────────────────────────────────────────────────── *
 *  Mirror resolver — follow the "Visit MultiMovies" CTA on multimovies.wtf
 * ──────────────────────────────────────────────────────────────────────── */

async function resolveMirror() {
  var now = Date.now();
  if (MIRROR_CACHE.url && MIRROR_CACHE.exp > now) return MIRROR_CACHE.url;
  var found = DEFAULT_MIRROR;
  try {
    var res = await fetch(DOMAIN_RESOLVER, { headers: HEADERS, signal: timeoutSignal(6000) });
    if (res && res.ok) {
      var html = await res.text();
      // The pointer page exposes several buttons/CTAs; the cta-primary one is
      // the canonical "Visit MultiMovies". Fall back to any multimovies-ish
      // link if the class name shifts.
      var m = html.match(/<a[^>]+class="[^"]*cta-primary[^"]*"[^>]+href="([^"]+)"/i)
        || html.match(/<a[^>]+href="(https?:\/\/[^"]*multimovies[^"]*)"[^>]*class="[^"]*cta-primary[^"]*"/i)
        || html.match(/<a[^>]+href="(https?:\/\/m\d*\.multimovies\.[a-z]+[^"]*)"/i);
      if (m && m[1]) found = m[1].replace(/\/+$/, "");
    }
  } catch (e) {
    warn("resolveMirror", e);
  }
  MIRROR_CACHE = { url: found, exp: now + MIRROR_TTL_MS };
  return found;
}

/* ──────────────────────────────────────────────────────────────────────── *
 *  TMDB resolver — same shape used by the sibling animesalt provider.
 * ──────────────────────────────────────────────────────────────────────── */

async function fetchTmdbDetails(tmdbId, mediaType, userApiKey) {
  var apiKey = userApiKey || DEFAULT_TMDB_KEY;
  var resolvedId = tmdbId;

  if (typeof tmdbId === "string" && tmdbId.trim().toLowerCase().startsWith("tt")) {
    try {
      var findRes = await fetch(
        TMDB_BASE_URL + "/find/" + tmdbId.trim() + "?api_key=" + apiKey + "&external_source=imdb_id",
        { headers: HEADERS, signal: timeoutSignal(8000) }
      );
      if (findRes && findRes.ok) {
        var findData = await findRes.json();
        var results = mediaType === "tv" ? findData.tv_results : findData.movie_results;
        if (results && results.length > 0) resolvedId = results[0].id;
      }
    } catch (e) { warn("tmdb:find", e); }
  }

  try {
    var endpoint = mediaType === "movie" ? "movie" : "tv";
    var res = await fetch(
      TMDB_BASE_URL + "/" + endpoint + "/" + resolvedId + "?api_key=" + apiKey + "&append_to_response=alternative_titles,external_ids",
      { headers: HEADERS, signal: timeoutSignal(8000) }
    );
    if (!res || !res.ok) return null;
    var data = await res.json();
    var title = mediaType === "movie" ? (data.title || data.original_title) : (data.name || data.original_name);
    var originalTitle = mediaType === "movie" ? data.original_title : data.original_name;
    var releaseDate = data.release_date || data.first_air_date || "";
    var year = parseInt(releaseDate.substring(0, 4), 10) || null;

    var aliases = new Set();
    if (originalTitle && originalTitle !== title) aliases.add(originalTitle);
    var altList = (data.alternative_titles && (data.alternative_titles.titles || data.alternative_titles.results)) || [];
    for (var i = 0; i < altList.length; i++) {
      var altTitle = altList[i].title || altList[i].name;
      if (altTitle && altTitle.trim()) aliases.add(altTitle.trim());
    }

    return {
      id: resolvedId,
      title: (title || "").trim(),
      originalTitle: (originalTitle || "").trim(),
      aliases: Array.from(aliases),
      year: year,
      imdbId: (data.external_ids && data.external_ids.imdb_id) || null
    };
  } catch (e) {
    warn("tmdb:details", e);
    return null;
  }
}

/* ──────────────────────────────────────────────────────────────────────── *
 *  Search — /search?q= with HTML parsing. Picks movie/series anchors and
 *  scores them against TMDB title + aliases + release year.
 * ──────────────────────────────────────────────────────────────────────── */

async function searchMultimovies(mirror, query) {
  try {
    var res = await fetch(
      mirror + "/search?q=" + encodeURIComponent(query),
      { headers: HEADERS, signal: timeoutSignal(10000) }
    );
    if (!res || !res.ok) return [];
    var html = await res.text();
    var $ = cheerio.load(html);
    var out = [];
    var seen = new Set();
    $("a").each(function (_, el) {
      var href = $(el).attr("href") || "";
      if (!(href.indexOf("/movie/") === 0 || href.indexOf("/series/") === 0)) return;
      // Skip hash/query fragments on the same card
      var clean = href.split("#")[0].split("?")[0];
      if (seen.has(clean)) return;
      var title = $(el).attr("aria-label") || $(el).attr("title") || $(el).text().trim();
      if (!title) return;
      seen.add(clean);
      out.push({ title: title.trim(), href: mirror + clean });
    });
    return out;
  } catch (e) {
    warn("search", e);
    return [];
  }
}

async function findBestMatch(mirror, details, mediaType) {
  if (!details || !details.title) return null;

  var queries = [];
  var qSeen = new Set();
  function pushQ(q) {
    if (!q) return;
    var k = q.toLowerCase();
    if (qSeen.has(k)) return;
    qSeen.add(k);
    queries.push(q);
  }
  pushQ(details.title);
  pushQ(cleanTitle(details.title));
  (details.aliases || []).slice(0, 3).forEach(function (a) { pushQ(a); pushQ(cleanTitle(a)); });

  var all = [];
  for (var i = 0; i < queries.length; i++) {
    var r = await searchMultimovies(mirror, queries[i]);
    if (r && r.length) {
      all = r;
      break;
    }
  }
  if (!all.length) return null;

  var best = null;
  var bestScore = -1;
  for (var j = 0; j < all.length; j++) {
    var item = all[j];
    var score = titleSimilarity(details.title, item.title);
    if (score < 0.9 && details.aliases) {
      for (var a = 0; a < details.aliases.length; a++) {
        var s2 = titleSimilarity(details.aliases[a], item.title);
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
    if (score > bestScore) {
      bestScore = score;
      best = item;
    }
  }
  return best || all[0];
}

/* ──────────────────────────────────────────────────────────────────────── *
 *  Page fetcher — grabs the watchConfig JSON from the movie/episode page.
 * ──────────────────────────────────────────────────────────────────────── */

function buildEpisodeUrl(seriesUrl, season, episode) {
  var clean = seriesUrl.replace(/\/+$/, "");
  return clean + "/season/" + season + "/episode/" + episode;
}

async function fetchWatchConfig(pageUrl) {
  try {
    var res = await fetch(pageUrl, { headers: HEADERS, signal: timeoutSignal(12000) });
    if (!res || !res.ok) return null;
    var html = await res.text();
    return extractJsonAssignment(html, "watchConfig");
  } catch (e) {
    warn("fetchWatchConfig", e);
    return null;
  }
}

/* ──────────────────────────────────────────────────────────────────────── *
 *  Extractor: Vidrift (embed.vidrift.net)
 *    Page body has `embedMeta = {...}` whose `orionStreams` array lists
 *    language-tagged HLS masters relative to the embed origin.
 * ──────────────────────────────────────────────────────────────────────── */

async function extractVidrift(iframeUrl) {
  try {
    var res = await fetch(iframeUrl, {
      headers: Object.assign({}, HEADERS, {
        "Referer": "https://m1.multimovies.courses/",
        "Sec-Fetch-Dest": "iframe"
      }),
      signal: timeoutSignal(10000)
    });
    if (!res || !res.ok) return [];
    var html = await res.text();
    var meta = extractJsonAssignment(html, "embedMeta");
    if (!meta || !Array.isArray(meta.orionStreams)) return [];

    var origin;
    try { origin = new URL(iframeUrl).origin; }
    catch (e) { origin = "https://embed.vidrift.net"; }

    var streamHeaders = {
      "Referer": origin + "/",
      "Origin": origin,
      "User-Agent": USER_AGENT
    };

    return meta.orionStreams.map(function (s) {
      var relUrl = s.url || "";
      var absUrl = relUrl.indexOf("http") === 0 ? relUrl : origin + relUrl;
      var topHeight = 0;
      if (Array.isArray(s.rungs)) {
        for (var i = 0; i < s.rungs.length; i++) {
          var h = Number(s.rungs[i] && s.rungs[i].height);
          if (Number.isFinite(h) && h > topHeight) topHeight = h;
        }
      }
      var quality = heightToQuality(topHeight);
      var langLabel = String(s.name || "").replace(/^Orion\s*·\s*/i, "").trim() || "Original";
      return {
        name: "MultiMovies • Vidrift • " + quality + " • " + langLabel,
        url: absUrl,
        quality: quality,
        headers: streamHeaders,
        type: "m3u8"
      };
    }).filter(function (s) { return s.url && s.url.indexOf("http") === 0; });
  } catch (e) {
    warn("extractor:vidrift", e);
    return [];
  }
}

/* ──────────────────────────────────────────────────────────────────────── *
 *  Extractor: VIDOUT (vidout.pages.dev)
 *    Resolves via raw.githubusercontent.com/Watchout2025/api — keyed by TMDB
 *    id (not IMDb, despite what multimovies hands it) for both movies and TV.
 * ──────────────────────────────────────────────────────────────────────── */

async function extractVidout(details, mediaType, season, episode) {
  try {
    var tmdbNumericId = details && details.id;
    if (!tmdbNumericId) return [];

    var lookupUrl;
    if (mediaType === "movie") {
      lookupUrl = VIDOUT_GITHUB_BASE + "/hls/movie/" + tmdbNumericId;
    } else {
      lookupUrl = VIDOUT_GITHUB_BASE + "/hls/tv/" + tmdbNumericId + "/S" + season + ".json";
    }

    var res = await fetch(lookupUrl, {
      headers: { "User-Agent": USER_AGENT, "Accept": "text/plain, application/json;q=0.8, */*;q=0.1" },
      signal: timeoutSignal(10000)
    });
    if (!res || !res.ok) return [];

    var streamUrl = null;
    if (mediaType === "movie") {
      streamUrl = (await res.text()).trim();
    } else {
      var jsonText = await res.text();
      var map;
      try { map = JSON.parse(jsonText); } catch (e) { warn("vidout:json", e); return []; }
      streamUrl = map && map[String(episode)] ? String(map[String(episode)]).trim() : "";
    }

    if (!streamUrl) return [];
    // The GitHub repo intentionally returns 200 with empty body or `.txt`
    // sentinels for missing entries — treat them as unresolved rather than
    // emitting an unplayable stream.
    var lower = streamUrl.toLowerCase();
    if (streamUrl.indexOf("http") !== 0) return [];
    if (lower.indexOf("#") !== -1) return []; // iframe-fallback marker
    if (lower.indexOf(".m3u8") === -1 && lower.indexOf("master") === -1 && lower.indexOf("/hls") === -1) {
      return [];
    }

    return [{
      name: "MultiMovies • VIDOUT • 720p • Original",
      url: streamUrl,
      quality: "720p",
      headers: {
        "Referer": "https://vidout.pages.dev/",
        "Origin": "https://vidout.pages.dev",
        "User-Agent": USER_AGENT
      },
      type: "m3u8"
    }];
  } catch (e) {
    warn("extractor:vidout", e);
    return [];
  }
}

/* ──────────────────────────────────────────────────────────────────────── *
 *  Extractor: Cineverse (modiplay.xyz)
 *    The Cineverse page is itself an aggregator of sub-embeds. We look for
 *    vidara.to entries (the only sub-embed with a stable JSON API), extract
 *    the filecode, and POST to gasobni.com/api/stream for the HLS URL.
 *    Vidara streams are 1080p HEVC with multiplexed Hindi/Tamil/Telugu/Kannada
 *    audio tracks — the highest-quality option Cineverse exposes.
 * ──────────────────────────────────────────────────────────────────────── */

async function extractVidaraByFilecode(filecode) {
  try {
    var res = await fetch("https://gasobni.com/api/stream", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Accept": "application/json, text/plain, */*",
        "Origin": "https://gasobni.com",
        "Referer": "https://gasobni.com/e/" + filecode,
        "User-Agent": USER_AGENT
      },
      body: JSON.stringify({ filecode: filecode, device: "web", codecs: [] }),
      signal: timeoutSignal(10000)
    });
    if (!res || !res.ok) return null;
    var data = await res.json();
    if (!data || !data.streaming_url) return null;
    return data;
  } catch (e) {
    warn("extractor:vidara", e);
    return null;
  }
}

function parseQualityFromTitle(title) {
  var t = String(title || "").toLowerCase();
  if (t.indexOf("2160") !== -1 || t.indexOf("4k") !== -1) return "4K";
  if (t.indexOf("1440") !== -1) return "1440p";
  if (t.indexOf("1080") !== -1) return "1080p";
  if (t.indexOf("720") !== -1) return "720p";
  if (t.indexOf("480") !== -1) return "480p";
  if (t.indexOf("360") !== -1) return "360p";
  return "Auto";
}

async function extractCineverse(iframeUrl) {
  try {
    var res = await fetch(iframeUrl, {
      headers: Object.assign({}, HEADERS, {
        "Referer": "https://m1.multimovies.courses/",
        "Sec-Fetch-Dest": "iframe"
      }),
      signal: timeoutSignal(12000)
    });
    if (!res || !res.ok) return [];
    var html = await res.text();

    // Scan every element with both data-url and data-platform. We only route
    // vidara entries today — other platforms (streamhg/earnvids/bingr/…)
    // require per-host JS execution.
    var subEmbeds = [];
    var re = /<[^>]*data-url="([^"]+)"[^>]*data-platform="([^"]+)"/gi;
    var m;
    while ((m = re.exec(html)) !== null) {
      subEmbeds.push({ url: m[1].replace(/&amp;/g, "&"), platform: m[2].toLowerCase() });
    }

    var out = [];
    for (var i = 0; i < subEmbeds.length; i++) {
      var sub = subEmbeds[i];
      if (sub.platform !== "vidara") continue;
      // vidara URL looks like https://vidara.to/e/{filecode}
      var fcMatch = sub.url.match(/\/e\/([A-Za-z0-9_-]+)/);
      if (!fcMatch) continue;
      var filecode = fcMatch[1];
      var payload = await extractVidaraByFilecode(filecode);
      if (!payload || !payload.streaming_url) continue;
      var quality = parseQualityFromTitle(payload.title) || "Auto";
      var langs = "Multi";
      var titleLower = String(payload.title || "").toLowerCase();
      if (titleLower.indexOf("hindi") !== -1 || titleLower.indexOf("tamil") !== -1 || titleLower.indexOf("telugu") !== -1) {
        langs = "Multi-Audio";
      }
      out.push({
        name: "MultiMovies • Cineverse/Vidara • " + quality + " • " + langs,
        url: payload.streaming_url,
        quality: quality,
        headers: {
          "Referer": "https://gasobni.com/",
          "Origin": "https://gasobni.com",
          "User-Agent": USER_AGENT
        },
        type: "m3u8"
      });
    }
    return out;
  } catch (e) {
    warn("extractor:cineverse", e);
    return [];
  }
}

/* ──────────────────────────────────────────────────────────────────────── *
 *  Router — maps a watchConfig server entry to its extractor.
 * ──────────────────────────────────────────────────────────────────────── */

function routeServer(server, details, mediaType, season, episode) {
  if (!server || !server.url) return Promise.resolve([]);
  var url = String(server.url);
  if (url.indexOf("vidrift.net") !== -1) {
    return extractVidrift(url);
  }
  if (url.indexOf("vidout.pages.dev") !== -1) {
    return extractVidout(details, mediaType, season, episode);
  }
  if (url.indexOf("modiplay.") !== -1) {
    return extractCineverse(url);
  }
  // Other listed hosts (iqsmartgames/moviesnexus/filmu/vidbolt) require
  // heavier extraction (fingerprinted sessions / obfuscated JS); no extractor
  // yet — surface silently rather than failing the batch.
  return Promise.resolve([]);
}

/* ──────────────────────────────────────────────────────────────────────── *
 *  Entrypoint
 * ──────────────────────────────────────────────────────────────────────── */

async function getStreams(tmdbId, mediaType, seasonNum, episodeNum) {
  if (!mediaType) mediaType = "movie";
  if (seasonNum == null) seasonNum = 1;
  if (episodeNum == null) episodeNum = 1;
  try {
    if (!tmdbId) return [];

    var season = 1;
    var episode = 1;
    if (mediaType === "tv") {
      var v = validateEpisodeInput(seasonNum, episodeNum);
      if (!v) { warn("getStreams", "invalid season/episode: " + seasonNum + "/" + episodeNum); return []; }
      season = v.season;
      episode = v.episode;
    }

    var details = await fetchTmdbDetails(tmdbId, mediaType);
    if (!details || !details.title) return [];

    var mirror = await resolveMirror();

    var match = await findBestMatch(mirror, details, mediaType);
    if (!match || !match.href) return [];

    var pageUrl = mediaType === "tv"
      ? buildEpisodeUrl(match.href, season, episode)
      : match.href;

    var config = await fetchWatchConfig(pageUrl);
    // Series landing pages carry S1E1 by default — if the explicit episode
    // URL ever misses, fall back to the series landing.
    if (!config && mediaType === "tv") {
      config = await fetchWatchConfig(match.href);
    }
    if (!config || !Array.isArray(config.initialServers)) return [];

    var titleLabel = mediaType === "movie"
      ? details.title
      : (details.title + " - S" + season + "E" + episode);

    var batches = await Promise.allSettled(
      config.initialServers.map(function (s) { return routeServer(s, details, mediaType, season, episode); })
    );

    var seen = new Set();
    var candidates = [];
    for (var i = 0; i < batches.length; i++) {
      var b = batches[i];
      if (b.status !== "fulfilled" || !Array.isArray(b.value)) continue;
      for (var j = 0; j < b.value.length; j++) {
        var s = b.value[j];
        if (!s || !s.url || seen.has(s.url)) continue;
        seen.add(s.url);
        candidates.push({
          name: s.name,
          title: titleLabel,
          url: s.url,
          quality: s.quality || "Auto",
          headers: s.headers,
          subtitles: s.subtitles || [],
          provider: "multimovies",
          type: s.type || "m3u8"
        });
      }
    }

    candidates.sort(function (a, b) {
      var qa = QUALITY_ORDER[a.quality] || 0;
      var qb = QUALITY_ORDER[b.quality] || 0;
      return qb - qa;
    });

    return candidates;
  } catch (e) {
    warn("getStreams", e);
    return [];
  }
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = { getStreams };
}
if (typeof globalThis !== "undefined") {
  globalThis.getStreams = getStreams;
}
