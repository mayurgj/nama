const { HEADERS, unpack, parseQualityFromUrl, warn } = require("../constants");

/**
 * Extract a stream from an as-cdn / awstream / zephyrflick embed.
 * @param {string} url
 * @param {string} [langName]
 * @returns {Promise<import("../index").Stream | null>}
 */
async function extractAwsStream(url, langName = "Multi") {
  try {
    const hash = url.split("/").filter(Boolean).pop();
    if (!hash) return null;
    const origin = new URL(url).origin;

    const res = await fetch(url, { headers: HEADERS });
    if (!res.ok) return null;
    const html = await res.text();

    const postUrl = `${origin}/player/index.php?data=${hash}&do=getVideo`;
    const postRes = await fetch(postUrl, {
      method: "POST",
      headers: {
        ...HEADERS,
        "x-requested-with": "XMLHttpRequest",
        "Origin": origin,
        "Referer": url,
        "Content-Type": "application/x-www-form-urlencoded"
      },
      body: `hash=${encodeURIComponent(hash)}&r=${encodeURIComponent(origin)}`
    });

    if (!postRes.ok) return null;
    const json = await postRes.json();
    const m3u8 = json?.videoSource;
    if (!m3u8) return null;

    let subtitle = null;
    const packedMatch = html.match(/eval\(function\(p,a,c,k,e,d\)[\s\S]*?\.split\(['"]\|['"]\)/);
    if (packedMatch) {
      const unpacked = unpack(packedMatch[0]);
      const subMatch = unpacked.match(/"kind":\s*"captions"\s*,\s*"file":\s*"(https?:\/\/[^"]+)"/);
      if (subMatch) {
        subtitle = subMatch[1].replace(/\\/g, "");
      }
    }

    return {
      name: `AnimeSalt [AWSStream] [${langName}]`,
      url: m3u8,
      quality: parseQualityFromUrl(m3u8, "Auto"),
      headers: {
        "Referer": `${origin}/`,
        "Origin": origin,
        "User-Agent": HEADERS["User-Agent"]
      },
      subtitles: subtitle ? [{ lang: "English", url: subtitle }] : [],
      type: "m3u8"
    };
  } catch (e) {
    warn("extractor:awsstream", e);
    return null;
  }
}

module.exports = {
  extractAwsStream
};
