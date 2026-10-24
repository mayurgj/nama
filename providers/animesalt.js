/**
 * AnimeSalt Nuvio Scraper Plugin
 * Compatible with Nuvio App (Mobile & Android TV) and All-in-One-Nuvio
 * Source: https://animesalt.cx/
 * Generated: 2026-10-24T16:00:55.745Z
 */

var cheerio = typeof require !== 'undefined' ? require('cheerio-without-node-native') : (globalThis.cheerio || {});
var CryptoJS = typeof require !== 'undefined' ? require('crypto-js') : (globalThis.CryptoJS || {});

// --- Constants & Utilities ---
const MAIN_URL = "https://animesalt.cx";
const TMDB_BASE_URL = "https://api.themoviedb.org/3";
const DEFAULT_TMDB_KEY = "1865f43a0549ca50d341dd9ab8b29f49";
const USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36";

const HEADERS = {
  "User-Agent": USER_AGENT,
  "Accept": "*/*",
  "Accept-Language": "en-US,en;q=0.9"
};

/**
 * Logger that is silent by default. Enable by setting globalThis.NUVIO_DEBUG = true.
 * Centralising this means catch blocks keep failing gracefully without littering host logs.
 */
function warn(context, err) {
  const dbg = typeof globalThis !== "undefined" && globalThis.NUVIO_DEBUG === true;
  if (!dbg) return;
  if (typeof console === "undefined" || typeof console.warn !== "function") return;
  const msg = err && err.message ? err.message : String(err);
  console.warn(`[nuvio:${context}] ${msg}`);
}

/**
 * Normalize a title for comparison: lowercase, strip punctuation, collapse whitespace.
 * @param {string} str
 * @returns {string}
 */
function cleanTitle(str) {
  return (str || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Rough string similarity in [0, 1] based on cleaned-title word overlap.
 * @param {string} a
 * @param {string} b
 * @returns {number}
 */
function titleSimilarity(a, b) {
  const cleanA = cleanTitle(a);
  const cleanB = cleanTitle(b);
  if (!cleanA || !cleanB) return 0;
  if (cleanA === cleanB) return 1;
  if (cleanA.includes(cleanB) || cleanB.includes(cleanA)) return 0.8;

  const wordsA = new Set(cleanA.split(" "));
  const wordsB = new Set(cleanB.split(" "));
  let intersection = 0;
  for (const w of wordsA) {
    if (wordsB.has(w)) intersection++;
  }
  return (intersection * 2) / (wordsA.size + wordsB.size);
}

/**
 * Reverse Dean Edwards' p.a.c.k.e.r. Returns the original code if the input
 * isn't packed or unpacking fails.
 * @param {string} code
 * @returns {string}
 */
function unpack(code) {
  try {
    const match = code.match(/}\((['"])([\s\S]*?)\1,\s*(\d+),\s*(\d+),\s*(['"])([\s\S]*?)\5\.split\((['"])\|\7\)/);
    if (match) {
      let [_, quote1, p, a, c, quote2, kStr] = match;
      p = p.replace(/\\'/g, "'").replace(/\\"/g, '"').replace(/\\\\/g, "\\");
      const radix = parseInt(a, 10);
      let count = parseInt(c, 10);
      const k = kStr.split("|");
      const e = (c2) =>
        (c2 < radix ? "" : e(Math.floor(c2 / radix))) +
        ((c2 = c2 % radix) > 35 ? String.fromCharCode(c2 + 29) : c2.toString(36));
      const d = {};
      while (count--) {
        d[e(count)] = k[count] || e(count);
      }
      return p.replace(/\b\w+\b/g, (w) => (Object.prototype.hasOwnProperty.call(d, w) ? d[w] : w));
    }
  } catch (e) {
    warn("unpack", e);
  }
  return code;
}

/**
 * Join a base URL with a path. Preserves absolute URLs and promotes
 * protocol-relative (//host) to https.
 * @param {string} base
 * @param {string} p
 * @returns {string}
 */
function joinUrl(base, p) {
  if (!p) return base;
  if (p.startsWith("http://") || p.startsWith("https://")) return p;
  if (p.startsWith("//")) return `https:${p}`;
  const b = base.endsWith("/") ? base.slice(0, -1) : base;
  const suffix = p.startsWith("/") ? p : `/${p}`;
  return `${b}${suffix}`;
}

/**
 * Validate season/episode inputs. Returns null when either is not a positive integer.
 * @param {number|string} seasonNum
 * @param {number|string} episodeNum
 * @returns {{season: number, episode: number} | null}
 */
function validateEpisodeInput(seasonNum, episodeNum) {
  const s = Number(seasonNum);
  const e = Number(episodeNum);
  if (!Number.isInteger(s) || s < 1 || s > 9999) return null;
  if (!Number.isInteger(e) || e < 1 || e > 9999) return null;
  return { season: s, episode: e };
}

const QUALITY_PATTERNS = [
  { re: /(?:^|[^0-9])2160p?(?:[^0-9]|$)|(?:^|[^a-z0-9])4k(?:[^a-z0-9]|$)/i, q: "4K" },
  { re: /(?:^|[^0-9])1440p?(?:[^0-9]|$)|(?:^|[^a-z0-9])2k(?:[^a-z0-9]|$)/i, q: "1440p" },
  { re: /(?:^|[^0-9])1080p?(?:[^0-9]|$)|(?:^|[^a-z0-9])fhd(?:[^a-z0-9]|$)/i, q: "1080p" },
  { re: /(?:^|[^0-9])720p?(?:[^0-9]|$)|(?:^|[^a-z0-9])hd(?:[^a-z0-9]|$)/i, q: "720p" },
  { re: /(?:^|[^0-9])480p?(?:[^0-9]|$)/i, q: "480p" },
  { re: /(?:^|[^0-9])360p?(?:[^0-9]|$)/i, q: "360p" }
];

/**
 * Best-effort quality extraction from a stream URL or filename. m3u8 master
 * playlists usually have no quality marker, so "Auto" is the honest default.
 * @param {string} url
 * @param {string} fallback
 * @returns {string}
 */
function parseQualityFromUrl(url, fallback = "Auto") {
  if (!url || typeof url !== "string") return fallback;
  for (const { re, q } of QUALITY_PATTERNS) {
    if (re.test(url)) return q;
  }
  return fallback;
}

/**
 * Map an HLS variant's pixel height to our quality label.
 * @param {number} height
 * @returns {string}
 */
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

/**
 * Parse an HLS master playlist into a list of variant streams. Resolves
 * relative variant URLs against the master URL and carries forward the
 * master's query string when the variant has none — most signed-URL
 * schemes (CloudFront, Hydrax-style) need the token re-attached.
 * @param {string} text    Master playlist body
 * @param {string} baseUrl Master playlist URL (for relative resolution)
 * @returns {Array<{url: string, quality: string, height: number, bandwidth: number}>}
 */
function parseHlsMaster(text, baseUrl) {
  if (!text || typeof text !== "string") return [];
  const lines = text.split(/\r?\n/);
  const out = [];
  let masterQuery = "";
  try {
    masterQuery = new URL(baseUrl).search || "";
  } catch (_) {
    /* ignore */
  }
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line || !line.startsWith("#EXT-X-STREAM-INF:")) continue;
    let urlLine = (lines[i + 1] || "").trim();
    if (!urlLine || urlLine.startsWith("#")) continue;
    const resMatch = line.match(/RESOLUTION=(\d+)x(\d+)/i);
    if (!resMatch) continue;
    const bwMatch = line.match(/BANDWIDTH=(\d+)/i);
    const height = parseInt(resMatch[2], 10);
    const bandwidth = bwMatch ? parseInt(bwMatch[1], 10) : 0;
    let resolved;
    try {
      resolved = new URL(urlLine, baseUrl).toString();
    } catch (_) {
      continue;
    }
    if (masterQuery && !resolved.includes("?")) resolved += masterQuery;
    out.push({ url: resolved, quality: heightToQuality(height), height, bandwidth });
  }
  return out;
}

/**
 * Count EXT-X-MEDIA:TYPE=AUDIO entries in an HLS master. Signals that a
 * player should be given the master URL (not a variant) so audio-track
 * switching stays available in the native player UI.
 * @param {string} text
 * @returns {number}
 */
function hlsAudioTrackCount(text) {
  if (!text || typeof text !== "string") return 0;
  const matches = text.match(/#EXT-X-MEDIA:[^\n]*TYPE=AUDIO/gi);
  return matches ? matches.length : 0;
}

/**
 * True iff `url` looks like a direct playable media URL (not an embed page).
 * @param {unknown} url
 * @returns {boolean}
 */
function isRealStreamUrl(url) {
  if (!url || typeof url !== "string") return false;
  if (!url.startsWith("http://") && !url.startsWith("https://")) return false;
  const lowercase = url.toLowerCase();
  if (
    lowercase.includes("/embed/") ||
    lowercase.includes("/embed-") ||
    lowercase.includes("/e/") ||
    lowercase.includes("/play.php") ||
    lowercase.includes("/player.php") ||
    lowercase.includes("abyssplayer.com") ||
    lowercase.includes("short.icu") ||
    lowercase.includes("cloudy.upns.one") ||
    lowercase.includes("vidcloud.upns.ink") ||
    lowercase.includes("filesforever.link") ||
    lowercase.includes("strmup.to") ||
    lowercase.includes("emturbovid.com") ||
    lowercase.includes("animedekho.app") ||
    lowercase.includes("animesalt.cx") ||
    lowercase.includes("youtube.com") ||
    lowercase.includes("youtu.be") ||
    lowercase.includes("vimeo.com") ||
    lowercase.includes(".html") ||
    lowercase.includes(".htm") ||
    lowercase.includes(".php") ||
    lowercase.includes("#")
  ) {
    return false;
  }
  const isHls = lowercase.includes(".m3u8") || lowercase.includes("/hls/");
  const isMp4 = lowercase.includes(".mp4") || lowercase.includes("/sora/") || lowercase.includes("/stream/");
  const isDash = lowercase.includes(".mpd") || lowercase.includes("/dash/");
  return isHls || isMp4 || isDash || lowercase.includes(".mkv");
}

// --- TMDB Resolver ---
/**
 * @typedef {Object} TmdbDetails
 * @property {number|string} id
 * @property {string} title
 * @property {string} originalTitle
 * @property {string[]} aliases
 * @property {number|null} year
 * @property {string|null} imdbId
 */

/**
 * Fetch TMDB metadata by TMDB numeric id or IMDb id (`tt...`).
 * @param {string|number} tmdbId
 * @param {"movie"|"tv"} mediaType
 * @param {string} [userApiKey]
 * @returns {Promise<TmdbDetails|null>}
 */
async function fetchTmdbDetails(tmdbId, mediaType, userApiKey) {
  const apiKey = userApiKey || DEFAULT_TMDB_KEY;
  let resolvedId = tmdbId;

  if (typeof tmdbId === "string" && tmdbId.trim().toLowerCase().startsWith("tt")) {
    try {
      const findUrl = `${TMDB_BASE_URL}/find/${tmdbId.trim()}?api_key=${apiKey}&external_source=imdb_id`;
      const findRes = await fetch(findUrl, { headers: HEADERS });
      if (findRes.ok) {
        const findData = await findRes.json();
        const results = mediaType === "tv" ? findData.tv_results : findData.movie_results;
        if (results && results.length > 0) {
          resolvedId = results[0].id;
        }
      }
    } catch (e) {
      warn("tmdb:find", e);
    }
  }

  const endpoint = mediaType === "movie" ? "movie" : "tv";
  const url = `${TMDB_BASE_URL}/${endpoint}/${resolvedId}?api_key=${apiKey}&append_to_response=alternative_titles,external_ids`;

  try {
    const res = await fetch(url, { headers: HEADERS });
    if (!res.ok) return null;
    const data = await res.json();

    const title = mediaType === "movie"
      ? data.title || data.original_title
      : data.name || data.original_name;

    const originalTitle = mediaType === "movie"
      ? data.original_title
      : data.original_name;

    const releaseDate = data.release_date || data.first_air_date || "";
    const year = parseInt(releaseDate.substring(0, 4), 10) || null;

    const aliases = new Set();
    if (originalTitle && originalTitle !== title) {
      aliases.add(originalTitle);
    }

    const altList = data.alternative_titles?.titles || data.alternative_titles?.results || [];
    for (const alt of altList) {
      const altTitle = alt.title || alt.name;
      if (altTitle && altTitle.trim()) {
        aliases.add(altTitle.trim());
      }
    }

    return {
      id: resolvedId,
      title: (title || "").trim(),
      originalTitle: (originalTitle || "").trim(),
      aliases: Array.from(aliases),
      year,
      imdbId: data.external_ids?.imdb_id || null
    };
  } catch (e) {
    warn("tmdb:details", e);
    return null;
  }
}

// --- Search Engine ---
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
    if (!json?.success || !json?.data?.content) return [];

    const $ = cheerio.load(json.data.content);
    return parseResults($, "article, li");
  } catch (e) {
    warn("search:ajax", e);
    return [];
  }
}

// ToroFilm's direct ?s= search covers almost all queries and is one request;
// the admin-ajax infinite-scroll endpoint is kept as a fallback for the
// occasional case where the theme's archive query returns empty but the
// ajax query still finds the post (e.g. draft slugs that leaked into feeds).
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

  // Build a single ordered query list so the fallback behaviour is explicit:
  //   1. the TMDB primary title
  //   2. its cleaned form (strip punctuation, collapse whitespace)
  //   3. up to three TMDB aliases (and their cleaned forms)
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

    if (score < 0.9 && tmdbDetails.aliases?.length) {
      for (const alias of tmdbDetails.aliases) {
        const aliasScore = titleSimilarity(alias, item.title);
        if (aliasScore > score) {
          score = aliasScore;
        }
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

// --- Episode / Movie Resolver ---
/**
 * Resolve a specific episode page URL from a series landing page.
 * @param {string} seriesUrl
 * @param {number} seasonNum
 * @param {number} episodeNum
 * @param {string} showTitle
 * @returns {Promise<string|null>}
 */
async function resolveEpisodeUrl(seriesUrl, seasonNum, episodeNum, showTitle) {
  try {
    const res = await fetch(seriesUrl, { headers: HEADERS });
    if (!res.ok) return null;
    const html = await res.text();
    const $ = cheerio.load(html);

    // 1. ToroFilm season buttons -> admin-ajax episode list
    let seasonBtn = $(`div.season-buttons a[data-season="${seasonNum}"]`);
    if (seasonBtn.length === 0) {
      seasonBtn = $(`a[data-season="${seasonNum}"]`);
    }
    if (seasonBtn.length === 0) {
      seasonBtn = $("div.season-buttons a").first();
    }

    const postId = seasonBtn.attr("data-post");
    const dataSeason = seasonBtn.attr("data-season") || seasonNum;

    if (postId) {
      const epRes = await fetch(`${MAIN_URL}/wp-admin/admin-ajax.php`, {
        method: "POST",
        headers: {
          ...HEADERS,
          "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
          "X-Requested-With": "XMLHttpRequest",
          "Referer": seriesUrl
        },
        body: `action=action_select_season&season=${dataSeason}&post=${postId}`
      });

      if (epRes.ok) {
        const epHtml = await epRes.text();
        const $ep = cheerio.load(epHtml);
        const epArticles = $ep("li article, article.post, li");
        let targetEp = null;

        const epPats = [
          `x${episodeNum}`,
          `x0${episodeNum}`,
          `e${episodeNum}`,
          `e0${episodeNum}`,
          `episode ${episodeNum}`,
          `episode 0${episodeNum}`,
          `ep ${episodeNum}`,
          `ep 0${episodeNum}`,
          `ep-${episodeNum}`,
          `-${episodeNum}/`
        ];

        epArticles.each((idx, el) => {
          const epText = $ep(el).find("h2.entry-title, .entry-title, .num-epi").text().toLowerCase();
          const href = $ep(el).find("a").first().attr("href");
          if (!href) return;
          for (const pat of epPats) {
            if (epText.includes(pat) || href.toLowerCase().includes(pat)) {
              targetEp = href;
              return false;
            }
          }
        });

        if (!targetEp && epArticles.length >= episodeNum) {
          targetEp = $ep(epArticles[episodeNum - 1]).find("a").first().attr("href");
        }

        if (targetEp) return joinUrl(MAIN_URL, targetEp);
      }
    }

    // 2. Fallback: static episode links on the series page
    const directLinks = [];
    $("a").each((_, el) => {
      const href = $(el).attr("href") || "";
      if (href.includes("/episode/") || href.includes("/episodes/")) {
        directLinks.push({ href, text: $(el).text() });
      }
    });

    for (const item of directLinks) {
      const lower = `${item.href} ${item.text}`.toLowerCase();
      if (
        lower.includes(`x${episodeNum}`) ||
        lower.includes(`episode-${episodeNum}`) ||
        lower.includes(`episode ${episodeNum}`) ||
        lower.includes(`ep-${episodeNum}`)
      ) {
        return joinUrl(MAIN_URL, item.href);
      }
    }

    if (directLinks.length >= episodeNum) {
      return joinUrl(MAIN_URL, directLinks[episodeNum - 1].href);
    }

    return null;
  } catch (e) {
    warn("episodes:resolve", e);
    return null;
  }
}

// --- Embed Extractors ---
const QUALITY_RANK = { "4K": 6, "1440p": 5, "1080p": 4, "720p": 3, "480p": 2, "360p": 1, "240p": 0, "144p": 0 };

/**
 * Extract streams from an as-cdn / awstream / zephyrflick / ravok embed.
 * Returns one Stream per HLS variant (1080p / 720p / ...). Audio is
 * always labelled "Multi" because the master playlist typically
 * includes multiple audio tracks that the player picks between.
 * @param {string} url
 * @param {string} [_langName] Ignored — kept for route-table parity.
 * @returns {Promise<Array<import("../index").Stream>>}
 */
async function extractAwsStream(url, _langName = "Multi") {
  try {
    const hash = url.split("/").filter(Boolean).pop();
    if (!hash) return [];
    const origin = new URL(url).origin;

    const res = await fetch(url, { headers: HEADERS });
    if (!res.ok) return [];
    const html = await res.text();

    const postUrl = `${origin}/player/index.php?data=${hash}&do=getVideo`;
    const postRes = await fetch(postUrl, {
      method: "POST",
      headers: {
        ...HEADERS,
        "x-requested-with": "XMLHttpRequest",
        "Origin": origin,
        "Referer": url,
        "Content-Type": "application/x-www-form-urlencoded"
      },
      body: `hash=${encodeURIComponent(hash)}&r=${encodeURIComponent(origin)}`
    });

    if (!postRes.ok) return [];
    const json = await postRes.json();
    const master = json?.videoSource;
    if (!master) return [];

    let subtitle = null;
    const packedMatch = html.match(/eval\(function\(p,a,c,k,e,d\)[\s\S]*?\.split\(['"]\|['"]\)/);
    if (packedMatch) {
      const unpacked = unpack(packedMatch[0]);
      const subMatch = unpacked.match(/"kind":\s*"captions"\s*,\s*"file":\s*"(https?:\/\/[^"]+)"/);
      if (subMatch) {
        subtitle = subMatch[1].replace(/\\/g, "");
      }
    }

    const commonHeaders = {
      "Referer": `${origin}/`,
      "Origin": origin,
      "User-Agent": HEADERS["User-Agent"]
    };
    const subtitles = subtitle ? [{ lang: "English", url: subtitle }] : [];

    let variants = [];
    let audioCount = 0;
    try {
      const masterRes = await fetch(master, { headers: commonHeaders });
      if (masterRes.ok) {
        const body = await masterRes.text();
        variants = parseHlsMaster(body, master);
        audioCount = hlsAudioTrackCount(body);
      }
    } catch (e) {
      warn("extractor:awsstream:master", e);
    }

    // When the master lists multiple audio tracks, serve the master URL
    // (not a variant) so the player keeps the audio-track switcher.
    // Variant playlists reference the master's EXT-X-MEDIA entries;
    // handing the player a variant hides them.
    if (audioCount >= 2) {
      const topQuality = variants.length
        ? variants
            .map((v) => v.quality)
            .reduce((a, b) => ((QUALITY_RANK[a] ?? -1) >= (QUALITY_RANK[b] ?? -1) ? a : b))
        : parseQualityFromUrl(master, "Auto");
      return [
        {
          name: `AnimeSalt • AWSStream • ${topQuality} • Multi`,
          url: master,
          quality: topQuality,
          headers: commonHeaders,
          subtitles,
          type: "m3u8"
        }
      ];
    }

    if (variants.length === 0) {
      return [
        {
          name: `AnimeSalt • AWSStream • ${parseQualityFromUrl(master, "Auto")} • Multi`,
          url: master,
          quality: parseQualityFromUrl(master, "Auto"),
          headers: commonHeaders,
          subtitles,
          type: "m3u8"
        }
      ];
    }

    return variants.map((v) => ({
      name: `AnimeSalt • AWSStream • ${v.quality} • Multi`,
      url: v.url,
      quality: v.quality,
      headers: commonHeaders,
      subtitles,
      type: "m3u8"
    }));
  } catch (e) {
    warn("extractor:awsstream", e);
    return [];
  }
}

/**
 * Extract a stream from a streamwish / pixdrive / ghbrisk / filesim embed.
 * @param {string} url
 * @param {string} [langName]
 * @returns {Promise<import("../index").Stream | null>}
 */
async function extractStreamWish(url, langName = "Multi") {
  try {
    const embedUrl = url.includes("/e/") ? url : url.replace("/f/", "/e/");
    const res = await fetch(embedUrl, { headers: HEADERS });
    if (!res.ok) return null;
    const html = await res.text();

    const packedMatch = html.match(/eval\(function\(p,a,c,k,e,d\)[\s\S]*?\.split\(['"]\|['"]\)/);
    if (!packedMatch) return null;

    const unpacked = unpack(packedMatch[0]);
    const fileMatch = unpacked.match(/file\s*:\s*["'](https?:\/\/[^"'\s]+\.m3u8(?:\?[^"'\s]*)?)["']/);
    if (!fileMatch) return null;

    const origin = new URL(embedUrl).origin;
    const quality = parseQualityFromUrl(fileMatch[1], "Auto");
    return {
      name: `AnimeSalt • StreamWish • ${quality} • ${langName}`,
      url: fileMatch[1],
      quality,
      headers: {
        "Referer": `${origin}/`,
        "Origin": origin,
        "User-Agent": HEADERS["User-Agent"]
      },
      type: "m3u8"
    };
  } catch (e) {
    warn("extractor:streamwish", e);
    return null;
  }
}

/**
 * Extract streams from a megaplay.buzz / rapid-cloud.co embed.
 * @param {string} url
 * @param {string} [langName]
 * @returns {Promise<Array<import("../index").Stream>>}
 */
async function extractMegaPlay(url, langName = "Multi") {
  try {
    let streamPageUrl = url;
    if (!url.includes("/stream/s-")) {
      const pageRes = await fetch(url, { headers: HEADERS });
      if (!pageRes.ok) return [];
      const html = await pageRes.text();
      const $ = cheerio.load(html);
      const embedSrc = $("iframe.s5-embed").attr("src");
      if (!embedSrc) return [];
      streamPageUrl = embedSrc;
    }

    const idMatch = streamPageUrl.match(/\/stream\/s-\d+\/(\d+)\//);
    if (!idMatch || !idMatch[1]) return [];
    const id = idMatch[1];
    const origin = new URL(streamPageUrl).origin;

    const apiHeaders = {
      "Accept": "*/*",
      "X-Requested-With": "XMLHttpRequest",
      "Referer": origin,
      "User-Agent": HEADERS["User-Agent"]
    };

    const apiRes = await fetch(`${origin}/stream/getSources?id=${id}`, { headers: apiHeaders });
    if (!apiRes.ok) return [];
    const resJson = await apiRes.json();

    let file = resJson?.sources?.file;
    const enc = resJson?.enc;

    if (!file && enc) {
      // Keys are public (reverse-engineered from the embed's client JS). Kept in
      // source so the bundle is self-contained; rotating them is the vendor's job.
      const keyStr = "i?LMTAx0Q6,:}50U";
      const keyHex = CryptoJS.enc.Utf8.parse(keyStr).toString(CryptoJS.enc.Hex).padEnd(64, "0");
      const key = CryptoJS.enc.Hex.parse(keyHex);
      const iv = CryptoJS.enc.Utf8.parse("W0;27ToaUpl_P%'c");
      const normalized = enc.replace(/-/g, "+").replace(/_/g, "/");
      const padded = normalized + "=".repeat((4 - (normalized.length % 4)) % 4);
      const decrypted = CryptoJS.AES.decrypt(padded, key, {
        iv,
        mode: CryptoJS.mode.CBC,
        padding: CryptoJS.pad.Pkcs7
      });
      const decObj = JSON.parse(decrypted.toString(CryptoJS.enc.Utf8));
      file = decObj?.file;
    }

    if (!file) return [];

    const tokenMatch = file.match(/\/([a-f0-9]{32})\/([a-f0-9]{32})\//i);
    if (tokenMatch && !file.includes("token=")) {
      const secret = "MpCdnT0k3n!9f2K#xQ7vL5mR8wN1pY4s";
      const expires = Math.floor(Date.now() / 1000) + 90;
      const payload = `${expires}|${tokenMatch[1]}/${tokenMatch[2]}`;
      const hash = CryptoJS.HmacSHA256(payload, secret);
      const b64Payload = CryptoJS.enc.Base64.stringify(CryptoJS.enc.Utf8.parse(payload))
        .replace(/\+/g, "-")
        .replace(/\//g, "_")
        .replace(/=+$/, "");
      const b64Sig = CryptoJS.enc.Base64.stringify(hash)
        .replace(/\+/g, "-")
        .replace(/\//g, "_")
        .replace(/=+$/, "");
      const token = `${b64Payload}.${b64Sig}`;
      file = `${file}${file.includes("?") ? "&" : "?"}token=${token}`;
    }

    const subtitles = (resJson?.tracks || [])
      .filter((t) => t.file && t.kind !== "thumbnails")
      .map((t) => ({ lang: t.label || "English", url: t.file }));

    const quality = parseQualityFromUrl(file, "Auto");
    return [
      {
        name: `AnimeSalt • MegaPlay • ${quality} • ${langName}`,
        url: file,
        quality,
        headers: {
          "Referer": `${origin}/`,
          "Origin": origin,
          "User-Agent": HEADERS["User-Agent"]
        },
        subtitles,
        type: "m3u8"
      }
    ];
  } catch (e) {
    warn("extractor:megaplay", e);
    return [];
  }
}

const LANG_ROUTES = [
  {
    match: (u) =>
      u.includes("as-cdn") ||
      u.includes("awstream") ||
      u.includes("zephyrflick") ||
      u.includes("ravok.buzz"),
    run: (link, lang) => extractAwsStream(link, lang)
  },
  {
    match: (u) => u.includes("megaplay.buzz") || u.includes("rapid-cloud.co"),
    run: (link, lang) => extractMegaPlay(link, lang)
  },
  {
    match: (u) =>
      u.includes("pixdrive") ||
      u.includes("ghbrisk") ||
      u.includes("streamwish") ||
      u.includes("filesim"),
    run: async (link, lang) => {
      const s = await extractStreamWish(link, lang);
      return s ? [s] : [];
    }
  }
];

/**
 * Extract streams from the base64-encoded JSON used by the multi-lang-plyr embed.
 * @param {string} dataParam
 * @returns {Promise<Array<import("../index").Stream>>}
 */
async function extractMultiLang(dataParam) {
  try {
    let decodedStr = "";
    if (typeof atob === "function") {
      decodedStr = atob(dataParam);
    } else {
      decodedStr = Buffer.from(dataParam, "base64").toString("utf-8");
    }

    const list = JSON.parse(decodedStr);
    if (!Array.isArray(list)) return [];

    const streamPromises = list.map(async (item) => {
      const lang = item.language || "Multi";
      const link = item.link;
      if (!link) return [];
      const route = LANG_ROUTES.find((r) => r.match(link));
      if (!route) return [];
      const res = await route.run(link, lang);
      return Array.isArray(res) ? res : [];
    });

    const results = await Promise.all(streamPromises);
    return results.flat();
  } catch (e) {
    warn("extractor:multilang", e);
    return [];
  }
}

// --- Main Scraper Entrypoint ---
/**
 * @typedef {Object} Stream
 * @property {string} name     Human-readable label (e.g. "AnimeSalt [MegaPlay] [English]")
 * @property {string} title    Movie title or "Show - S1E1"
 * @property {string} url      Direct playable URL (hls/mp4/mkv/mpd)
 * @property {string} quality  "4K" | "1440p" | "1080p" | "720p" | "480p" | "360p" | "Auto"
 * @property {Object<string,string>=} headers Required headers for playback (Referer, Origin, UA)
 * @property {Array<{lang: string, url: string}>=} subtitles
 * @property {string} provider "animesalt"
 * @property {string} type     "m3u8" | "mp4" | "mkv" | "mpd"
 */

const QUALITY_ORDER = { "4K": 6, "1440p": 5, "1080p": 4, "720p": 3, "480p": 2, "360p": 1, "Auto": 0 };

// Keep only 1080p+ qualities. "Auto" is kept because HLS master playlists
// have no explicit quality marker but typically include 1080p renditions.
const HD_PLUS = new Set(["4K", "1440p", "1080p", "Auto"]);

// Route table: first matching entry handles the iframe URL.
// Each `run` returns an array of raw streams (post-normalisation).
const EXTRACTOR_ROUTES = [
  {
    name: "multilang",
    // Covers both ToroFilm variants: /plyr/player.php?data=... and /multi-lang-plyr/player.php?data=...
    match: (u) => /\/(?:multi-lang-)?plyr\/player\.php\?/.test(u),
    run: async (iframeUrl) => {
      try {
        const dataParam = new URL(iframeUrl).searchParams.get("data");
        if (!dataParam) return [];
        const res = await extractMultiLang(dataParam);
        return Array.isArray(res) ? res : [];
      } catch (e) {
        warn("route:multilang", e);
        return [];
      }
    }
  },
  {
    name: "awsstream",
    match: (u) =>
      u.includes("as-cdn") ||
      u.includes("awstream") ||
      u.includes("zephyrflick") ||
      u.includes("ravok.buzz"),
    run: async (iframeUrl) => {
      const r = await extractAwsStream(iframeUrl);
      return Array.isArray(r) ? r : [];
    }
  },
  {
    name: "megaplay",
    match: (u) => u.includes("megaplay.buzz") || u.includes("rapid-cloud.co"),
    run: async (iframeUrl) => {
      const r = await extractMegaPlay(iframeUrl);
      return Array.isArray(r) ? r : [];
    }
  },
  {
    name: "streamwish",
    match: (u) =>
      u.includes("pixdrive") ||
      u.includes("ghbrisk") ||
      u.includes("streamwish") ||
      u.includes("filesim"),
    run: async (iframeUrl) => {
      const r = await extractStreamWish(iframeUrl);
      return r ? [r] : [];
    }
  }
];

function routeIframe(iframeUrl) {
  for (const route of EXTRACTOR_ROUTES) {
    if (route.match(iframeUrl)) return route.run(iframeUrl);
  }
  return Promise.resolve([]);
}

function collectIframeUrls($page) {
  const urls = new Set();
  $page("iframe").each((_, el) => {
    const src = $page(el).attr("data-src") || $page(el).attr("src");
    if (!src || src.startsWith("about:") || src.startsWith("javascript:")) return;
    urls.add(joinUrl(MAIN_URL, src));
  });
  $page("[data-embed], [data-src], [data-player]").each((_, el) => {
    const data = $page(el).attr("data-embed") || $page(el).attr("data-player");
    if (data && data.startsWith("http")) urls.add(data);
  });
  return urls;
}

/**
 * HEAD-ish probe: does this URL actually return bytes (not an HTML error page)?
 * @param {Stream} stream
 * @returns {Promise<boolean>}
 */
async function isPlayableStream(stream) {
  if (!isRealStreamUrl(stream?.url)) return false;
  try {
    const headers = {
      "User-Agent": HEADERS["User-Agent"],
      ...(stream.headers || {}),
      "Range": "bytes=0-10"
    };
    const res = await fetch(stream.url, {
      headers,
      signal: AbortSignal.timeout(3500)
    });
    if (!res.ok && res.status !== 206) return false;
    const contentType = res.headers.get("content-type") || "";
    if (contentType.includes("text/html")) return false;
    return true;
  } catch (e) {
    warn("probe", e);
    return false;
  }
}

/**
 * Resolve TMDB id → playable streams via animesalt.cx.
 * @param {string|number} tmdbId
 * @param {"movie"|"tv"} [mediaType]
 * @param {number} [seasonNum]
 * @param {number} [episodeNum]
 * @returns {Promise<Stream[]>}
 */
async function getStreams(tmdbId, mediaType = "movie", seasonNum = 1, episodeNum = 1) {
  try {
    if (!tmdbId) return [];
    let season = 1;
    let episode = 1;
    if (mediaType === "tv") {
      const v = validateEpisodeInput(seasonNum, episodeNum);
      if (!v) {
        warn("getStreams", `invalid season/episode: ${seasonNum}/${episodeNum}`);
        return [];
      }
      season = v.season;
      episode = v.episode;
    }

    const details = await fetchTmdbDetails(tmdbId, mediaType);
    if (!details || !details.title) return [];

    const bestMatch = await findBestMatch(details, mediaType);
    if (!bestMatch || !bestMatch.href) return [];

    let targetUrl = bestMatch.href;
    if (mediaType === "tv") {
      const epUrl = await resolveEpisodeUrl(bestMatch.href, season, episode, details.title);
      if (epUrl) targetUrl = epUrl;
    }

    const pageRes = await fetch(targetUrl, { headers: HEADERS });
    if (!pageRes.ok) return [];
    const $page = cheerio.load(await pageRes.text());

    const iframeUrls = collectIframeUrls($page);
    const results = await Promise.allSettled(
      Array.from(iframeUrls).map((u) => routeIframe(u))
    );

    const rawStreams = [];
    for (const r of results) {
      if (r.status === "fulfilled" && Array.isArray(r.value)) rawStreams.push(...r.value);
    }

    const titleLabel = mediaType === "movie"
      ? details.title
      : `${details.title} - S${season}E${episode}`;

    const seenUrls = new Set();
    const candidates = [];
    for (const s of rawStreams) {
      if (!s || !s.url || seenUrls.has(s.url) || !isRealStreamUrl(s.url)) continue;
      const q = s.quality || "Auto";
      if (!HD_PLUS.has(q)) continue;
      seenUrls.add(s.url);
      candidates.push({
        name: s.name || "AnimeSalt",
        title: titleLabel,
        url: s.url,
        quality: s.quality || "Auto",
        headers: s.headers,
        subtitles: s.subtitles || [],
        provider: "animesalt",
        type: s.type || "m3u8"
      });
    }

    const probed = await Promise.all(
      candidates.map(async (s) => ({ s, ok: await isPlayableStream(s) }))
    );
    const playable = probed.filter((r) => r.ok).map((r) => r.s);
    const finalStreams = playable.length > 0 ? playable : candidates;

    return finalStreams.sort((a, b) => {
      const qA = QUALITY_ORDER[a.quality] ?? 0;
      const qB = QUALITY_ORDER[b.quality] ?? 0;
      return qB - qA;
    });
  } catch (e) {
    warn("getStreams", e);
    return [];
  }
}

if (typeof module !== "undefined" && module.exports) {
  
}
if (typeof globalThis !== "undefined") {
  globalThis.getStreams = getStreams;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { getStreams };
}
if (typeof globalThis !== 'undefined') {
  globalThis.getStreams = getStreams;
}
