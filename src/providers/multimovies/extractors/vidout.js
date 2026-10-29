const { USER_AGENT, timeoutSignal, warn } = require("../../../shared/constants");
const { formatStream } = require("../../../shared/formatter");
const { VIDOUT_GITHUB_BASE } = require("../constants");

async function extractVidout(details, mediaType, season, episode) {
  try {
    const tmdbNumericId = details && details.id;
    if (!tmdbNumericId) return [];

    const lookupUrl = mediaType === "movie"
      ? `${VIDOUT_GITHUB_BASE}/hls/movie/${tmdbNumericId}`
      : `${VIDOUT_GITHUB_BASE}/hls/tv/${tmdbNumericId}/S${season}.json`;

    const res = await fetch(lookupUrl, {
      headers: { "User-Agent": USER_AGENT, "Accept": "text/plain, application/json;q=0.8, */*;q=0.1" },
      signal: timeoutSignal(10000)
    });
    if (!res || !res.ok) return [];

    let streamUrl = null;
    if (mediaType === "movie") {
      streamUrl = (await res.text()).trim();
    } else {
      const jsonText = await res.text();
      let map;
      try { map = JSON.parse(jsonText); }
      catch (e) { warn("vidout:json", e); return []; }
      streamUrl = map && map[String(episode)] ? String(map[String(episode)]).trim() : "";
    }

    if (!streamUrl) return [];
    // The GitHub repo intentionally returns 200 with empty body or `.txt`
    // sentinels for missing entries — treat them as unresolved.
    const lower = streamUrl.toLowerCase();
    if (streamUrl.indexOf("http") !== 0) return [];
    if (lower.indexOf("#") !== -1) return [];
    if (lower.indexOf(".m3u8") === -1 && lower.indexOf("master") === -1 && lower.indexOf("/hls") === -1) {
      return [];
    }

    return [formatStream({
      url: streamUrl,
      provider: "multimovies",
      type: "m3u8",
      resolution: "720p",
      languages: ["multi"],
      headers: {
        "Referer": "https://vidout.pages.dev/",
        "Origin": "https://vidout.pages.dev",
        "User-Agent": USER_AGENT
      }
    })];
  } catch (e) {
    warn("extractor:vidout", e);
    return [];
  }
}

module.exports = {
  extractVidout
};
