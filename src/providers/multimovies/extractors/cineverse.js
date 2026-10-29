const { HEADERS, USER_AGENT, timeoutSignal, warn } = require("../../../shared/constants");
const { formatStream } = require("../../../shared/formatter");

async function extractVidaraByFilecode(filecode) {
  try {
    const res = await fetch("https://gasobni.com/api/stream", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Accept": "application/json, text/plain, */*",
        "Origin": "https://gasobni.com",
        "Referer": `https://gasobni.com/e/${filecode}`,
        "User-Agent": USER_AGENT
      },
      body: JSON.stringify({ filecode, device: "web", codecs: [] }),
      signal: timeoutSignal(10000)
    });
    if (!res || !res.ok) return null;
    const data = await res.json();
    if (!data || !data.streaming_url) return null;
    return data;
  } catch (e) {
    warn("extractor:vidara", e);
    return null;
  }
}

async function extractCineverse(iframeUrl) {
  try {
    const res = await fetch(iframeUrl, {
      headers: {
        ...HEADERS,
        "Referer": "https://m1.multimovies.courses/",
        "Sec-Fetch-Dest": "iframe"
      },
      signal: timeoutSignal(12000)
    });
    if (!res || !res.ok) return [];
    const html = await res.text();

    // Scan every element with both data-url and data-platform. Only vidara
    // is routed today — the others need per-host JS execution.
    const subEmbeds = [];
    const re = /<[^>]*data-url="([^"]+)"[^>]*data-platform="([^"]+)"/gi;
    let m;
    while ((m = re.exec(html)) !== null) {
      subEmbeds.push({ url: m[1].replace(/&amp;/g, "&"), platform: m[2].toLowerCase() });
    }

    const out = [];
    for (const sub of subEmbeds) {
      if (sub.platform !== "vidara") continue;
      const fcMatch = sub.url.match(/\/e\/([A-Za-z0-9_-]+)/);
      if (!fcMatch) continue;
      const filecode = fcMatch[1];
      const payload = await extractVidaraByFilecode(filecode);
      if (!payload || !payload.streaming_url) continue;
      out.push(formatStream({
        url: payload.streaming_url,
        provider: "multimovies",
        type: "m3u8",
        // vidara payload titles look like "Jailer-2.2026.1080p.HEVC.Hindi-Tamil.x265"
        // — rich enough for the formatter to extract resolution/encode/audio/langs.
        title: payload.title || "",
        headers: {
          "Referer": "https://gasobni.com/",
          "Origin": "https://gasobni.com",
          "User-Agent": USER_AGENT
        }
      }));
    }
    return out;
  } catch (e) {
    warn("extractor:cineverse", e);
    return [];
  }
}

module.exports = {
  extractCineverse
};
