const { HEADERS, USER_AGENT, timeoutSignal, warn } = require("../../../shared/constants");
const { formatStream } = require("../../../shared/formatter");

async function extractFilmu(iframeUrl) {
  try {
    const res = await fetch(iframeUrl, {
      headers: {
        ...HEADERS,
        "Referer": "https://m1.multimovies.courses/",
        "Sec-Fetch-Dest": "iframe"
      },
      redirect: "follow",
      signal: timeoutSignal(15000)
    });
    if (!res || !res.ok) return [];
    const finalUrl = res.url || iframeUrl;
    const html = await res.text();

    const m = html.match(/https:\/\/proxy\.streamrip\.fun\/m\/[A-Za-z0-9_\-]+(?:\?[^"'\\\s<>]*)?/);
    if (!m) return [];
    let streamUrl = m[0];
    if (streamUrl.indexOf("f=.m3u8") === -1 && streamUrl.indexOf(".m3u8") === -1) {
      streamUrl = `${streamUrl}${streamUrl.indexOf("?") === -1 ? "?" : "&"}f=.m3u8`;
    }

    let origin;
    try { origin = new URL(finalUrl).origin; }
    catch (e) { origin = "https://vidly.pro"; }

    return [formatStream({
      url: streamUrl,
      provider: "multimovies",
      type: "m3u8",
      languages: ["multi"],
      headers: {
        "Referer": `${origin}/`,
        "Origin": origin,
        "User-Agent": USER_AGENT
      }
    })];
  } catch (e) {
    warn("extractor:filmu", e);
    return [];
  }
}

module.exports = {
  extractFilmu
};
