const { HEADERS, unpack, warn } = require("../../../shared/constants");
const { formatStream, parseResolution } = require("../../../shared/formatter");

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
    const languages = (!langName || langName === "Multi") ? ["multi"] : [langName];

    return formatStream({
      url: fileMatch[1],
      provider: "animesalt",
      type: "m3u8",
      resolution: parseResolution(fileMatch[1]),
      languages,
      headers: {
        "Referer": `${origin}/`,
        "Origin": origin,
        "User-Agent": HEADERS["User-Agent"]
      }
    });
  } catch (e) {
    warn("extractor:streamwish", e);
    return null;
  }
}

module.exports = {
  extractStreamWish
};
