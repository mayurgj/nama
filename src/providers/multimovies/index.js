const { RESOLUTION_ORDER, validateEpisodeInput, warn } = require("../../shared/constants");
const { fetchTmdbDetails } = require("../../shared/tmdb");
const { normalizeSeasonEpisode } = require("../../shared/formatter");
const { resolveMirror } = require("./constants");
const { findBestMatch, buildEpisodeUrl, fetchWatchConfig } = require("./search");
const { extractVidrift } = require("./extractors/vidrift");
const { extractVidout } = require("./extractors/vidout");
const { extractCineverse } = require("./extractors/cineverse");
const { extractVidbolt } = require("./extractors/vidbolt");
const { extractFilmu } = require("./extractors/filmu");

function routeServer(server, details, mediaType, season, episode) {
  if (!server || !server.url) return Promise.resolve([]);
  const url = String(server.url);
  if (url.indexOf("vidrift.net") !== -1) return extractVidrift(url);
  if (url.indexOf("vidout.pages.dev") !== -1) return extractVidout(details, mediaType, season, episode);
  if (url.indexOf("modiplay.") !== -1) return extractCineverse(url);
  if (url.indexOf("vidbolt.xyz") !== -1) return extractVidbolt(url, details, mediaType, season, episode);
  if (url.indexOf("filmu.in") !== -1 || url.indexOf("vidly.pro") !== -1) return extractFilmu(url);
  // iqsmartgames/moviesnexus need session-aware or Cloudflare-interactive
  // handling; no extractor yet.
  return Promise.resolve([]);
}

async function getStreams(tmdbId, mediaType, seasonNum, episodeNum) {
  if (!mediaType) mediaType = "movie";
  if (seasonNum == null) seasonNum = 1;
  if (episodeNum == null) episodeNum = 1;
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

    const mirror = await resolveMirror();
    const match = await findBestMatch(mirror, details, mediaType);
    if (!match || !match.href) return [];

    const pageUrl = mediaType === "tv"
      ? buildEpisodeUrl(match.href, season, episode)
      : match.href;

    let config = await fetchWatchConfig(pageUrl);
    // Series landing pages carry S1E1 by default — if the explicit episode
    // URL ever misses, fall back to the series landing.
    if (!config && mediaType === "tv") {
      config = await fetchWatchConfig(match.href);
    }
    if (!config || !Array.isArray(config.initialServers)) return [];

    const seasonEpisode = mediaType === "tv"
      ? normalizeSeasonEpisode({ season, episode })
      : null;

    const batches = await Promise.allSettled(
      config.initialServers.map((s) => routeServer(s, details, mediaType, season, episode))
    );

    const seen = new Set();
    const candidates = [];
    for (const b of batches) {
      if (b.status !== "fulfilled" || !Array.isArray(b.value)) continue;
      for (const stream of b.value) {
        if (!stream || !stream.url || seen.has(stream.url)) continue;
        seen.add(stream.url);
        if (seasonEpisode) stream.seasonEpisode = seasonEpisode;
        candidates.push(stream);
      }
    }

    candidates.sort((a, b) => {
      const qa = RESOLUTION_ORDER[a.resolution] != null ? RESOLUTION_ORDER[a.resolution] : -1;
      const qb = RESOLUTION_ORDER[b.resolution] != null ? RESOLUTION_ORDER[b.resolution] : -1;
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
