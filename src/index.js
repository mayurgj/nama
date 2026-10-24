const cheerio = require("cheerio-without-node-native");
const {
  MAIN_URL,
  HEADERS,
  isRealStreamUrl,
  validateEpisodeInput,
  joinUrl,
  warn
} = require("./constants");
const { fetchTmdbDetails } = require("./tmdb");
const { findBestMatch } = require("./search");
const { resolveEpisodeUrl } = require("./episodes");
const { extractMultiLang } = require("./extractors/multilang");
const { extractAwsStream } = require("./extractors/awsstream");
const { extractMegaPlay } = require("./extractors/megaplay");
const { extractStreamWish } = require("./extractors/streamwish");
const { extractAbyss } = require("./extractors/abyss");

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
    match: (u) => u.includes("as-cdn") || u.includes("awstream") || u.includes("zephyrflick"),
    run: async (iframeUrl) => {
      const r = await extractAwsStream(iframeUrl);
      return r ? [r] : [];
    }
  },
  {
    name: "abyss",
    match: (u) => u.includes("abyssplayer.com") || u.includes("short.icu"),
    run: async (iframeUrl) => {
      const r = await extractAbyss(iframeUrl);
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
  module.exports = { getStreams };
}
if (typeof globalThis !== "undefined") {
  globalThis.getStreams = getStreams;
}
