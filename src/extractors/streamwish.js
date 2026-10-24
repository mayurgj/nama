const { HEADERS, unpack, parseQualityFromUrl, warn } = require("../constants");

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

module.exports = {
  extractStreamWish
};
