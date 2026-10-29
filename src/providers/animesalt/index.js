const cheerio = require("cheerio-without-node-native");
const {
  HEADERS,
  RESOLUTION_ORDER,
  isRealStreamUrl,
  validateEpisodeInput,
  joinUrl,
  warn
} = require("../../shared/constants");
const { fetchTmdbDetails } = require("../../shared/tmdb");
const { normalizeSeasonEpisode } = require("../../shared/formatter");
const { MAIN_URL } = require("./constants");
const { findBestMatch } = require("./search");
const { resolveEpisodeUrl } = require("./episodes");
const { extractMultiLang } = require("./extractors/multilang");
const { extractAwsStream } = require("./extractors/awsstream");
const { extractMegaPlay } = require("./extractors/megaplay");
const { extractStreamWish } = require("./extractors/streamwish");

// Keep only HD+ resolutions. Null (resolution unknown) is kept because HLS
// masters without a declared variant are usually 1080p-capable.
const HD_PLUS = new Set(["2160p", "1440p", "1080p", null]);

const EXTRACTOR_ROUTES = [
  {
    name: "multilang",
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

async function isPlayableStream(stream) {
  if (!isRealStreamUrl(stream && stream.url)) return false;
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

    const seasonEpisode = mediaType === "tv"
      ? normalizeSeasonEpisode({ season, episode })
      : null;

    const seen = new Set();
    const candidates = [];
    for (const r of results) {
      if (r.status !== "fulfilled" || !Array.isArray(r.value)) continue;
      for (const stream of r.value) {
        if (!stream || !stream.url || seen.has(stream.url)) continue;
        if (!isRealStreamUrl(stream.url)) continue;
        if (!HD_PLUS.has(stream.resolution)) continue;
        seen.add(stream.url);
        if (seasonEpisode) stream.seasonEpisode = seasonEpisode;
        candidates.push(stream);
      }
    }

    const probed = await Promise.all(
      candidates.map(async (s) => ({ s, ok: await isPlayableStream(s) }))
    );
    const playable = probed.filter((r) => r.ok).map((r) => r.s);
    const final = playable.length > 0 ? playable : candidates;

    return final.sort((a, b) => {
      const qA = RESOLUTION_ORDER[a.resolution] != null ? RESOLUTION_ORDER[a.resolution] : -1;
      const qB = RESOLUTION_ORDER[b.resolution] != null ? RESOLUTION_ORDER[b.resolution] : -1;
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
