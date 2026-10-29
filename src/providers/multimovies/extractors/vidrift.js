const { HEADERS, USER_AGENT, heightToQuality, timeoutSignal, warn } = require("../../../shared/constants");
const { formatStream } = require("../../../shared/formatter");
const { extractJsonAssignment } = require("../constants");

async function extractVidrift(iframeUrl) {
  try {
    const res = await fetch(iframeUrl, {
      headers: {
        ...HEADERS,
        "Referer": "https://m1.multimovies.courses/",
        "Sec-Fetch-Dest": "iframe"
      },
      signal: timeoutSignal(10000)
    });
    if (!res || !res.ok) return [];
    const html = await res.text();
    const meta = extractJsonAssignment(html, "embedMeta");
    if (!meta || !Array.isArray(meta.orionStreams)) return [];

    let origin;
    try { origin = new URL(iframeUrl).origin; }
    catch (e) { origin = "https://embed.vidrift.net"; }

    const streamHeaders = {
      "Referer": `${origin}/`,
      "Origin": origin,
      "User-Agent": USER_AGENT
    };

    return meta.orionStreams.map((s) => {
      const relUrl = s.url || "";
      const absUrl = relUrl.indexOf("http") === 0 ? relUrl : `${origin}${relUrl}`;
      let topHeight = 0;
      if (Array.isArray(s.rungs)) {
        for (const r of s.rungs) {
          const h = Number(r && r.height);
          if (Number.isFinite(h) && h > topHeight) topHeight = h;
        }
      }
      const resolution = heightToQuality(topHeight);
      // "Orion · Hindi" / "Orion · Original" — the right-hand side is the
      // audio-track label we hand to the language parser.
      const langLabel = String(s.name || "").replace(/^Orion\s*·\s*/i, "").trim() || "Original";
      return formatStream({
        url: absUrl,
        provider: "multimovies",
        type: "m3u8",
        resolution,
        title: langLabel,
        headers: streamHeaders
      });
    }).filter((s) => s.url && s.url.indexOf("http") === 0);
  } catch (e) {
    warn("extractor:vidrift", e);
    return [];
  }
}

module.exports = {
  extractVidrift
};
