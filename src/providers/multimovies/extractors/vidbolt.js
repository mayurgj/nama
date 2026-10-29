const { HEADERS, USER_AGENT, timeoutSignal, warn } = require("../../../shared/constants");
const { formatStream, parseResolution, parseLanguages } = require("../../../shared/formatter");

async function extractVidbolt(iframeUrl, details, mediaType, season, episode) {
  try {
    const tmdbId = details && details.id;
    if (!tmdbId) return [];
    let api = `https://vidbolt.xyz/api/resolve?type=${mediaType === "tv" ? "tv" : "movie"}&id=${tmdbId}`;
    if (mediaType === "tv") api += `&s=${season}&e=${episode}`;

    const res = await fetch(api, {
      headers: {
        ...HEADERS,
        "Accept": "application/json, text/plain, */*",
        "Referer": iframeUrl,
        "Origin": "https://vidbolt.xyz"
      },
      signal: timeoutSignal(10000)
    });
    if (!res || !res.ok) return [];
    const data = await res.json();
    if (!data || !data.stream || !Array.isArray(data.stream.sources)) return [];

    return data.stream.sources.map((src) => {
      if (!src || !src.url) return null;
      const resolution = src.quality || parseResolution(src.url);
      const languages = src.language ? parseLanguages(String(src.language)) : [];
      return formatStream({
        url: String(src.url),
        provider: "multimovies",
        type: src.kind === "mp4" ? "mp4" : "m3u8",
        resolution,
        languages,
        title: src.title || src.url,
        headers: {
          "Referer": "https://vidbolt.xyz/",
          "Origin": "https://vidbolt.xyz",
          "User-Agent": USER_AGENT
        }
      });
    }).filter(Boolean);
  } catch (e) {
    warn("extractor:vidbolt", e);
    return [];
  }
}

module.exports = {
  extractVidbolt
};
