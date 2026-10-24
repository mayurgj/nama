const { HEADERS, unpack, parseQualityFromUrl, parseHlsMaster, warn } = require("../constants");

/**
 * Extract streams from an as-cdn / awstream / zephyrflick / ravok embed.
 * Returns one Stream per HLS variant (1080p / 720p / ...). Audio is
 * always labelled "Multi" because the master playlist typically
 * includes multiple audio tracks that the player picks between.
 * @param {string} url
 * @param {string} [_langName] Ignored — kept for route-table parity.
 * @returns {Promise<Array<import("../index").Stream>>}
 */
async function extractAwsStream(url, _langName = "Multi") {
  try {
    const hash = url.split("/").filter(Boolean).pop();
    if (!hash) return [];
    const origin = new URL(url).origin;

    const res = await fetch(url, { headers: HEADERS });
    if (!res.ok) return [];
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

    if (!postRes.ok) return [];
    const json = await postRes.json();
    const master = json?.videoSource;
    if (!master) return [];

    let subtitle = null;
    const packedMatch = html.match(/eval\(function\(p,a,c,k,e,d\)[\s\S]*?\.split\(['"]\|['"]\)/);
    if (packedMatch) {
      const unpacked = unpack(packedMatch[0]);
      const subMatch = unpacked.match(/"kind":\s*"captions"\s*,\s*"file":\s*"(https?:\/\/[^"]+)"/);
      if (subMatch) {
        subtitle = subMatch[1].replace(/\\/g, "");
      }
    }

    const commonHeaders = {
      "Referer": `${origin}/`,
      "Origin": origin,
      "User-Agent": HEADERS["User-Agent"]
    };
    const subtitles = subtitle ? [{ lang: "English", url: subtitle }] : [];

    let variants = [];
    try {
      const masterRes = await fetch(master, { headers: commonHeaders });
      if (masterRes.ok) {
        const body = await masterRes.text();
        variants = parseHlsMaster(body, master);
      }
    } catch (e) {
      warn("extractor:awsstream:master", e);
    }

    if (variants.length === 0) {
      return [
        {
          name: `AnimeSalt • AWSStream • ${parseQualityFromUrl(master, "Auto")} • Multi`,
          url: master,
          quality: parseQualityFromUrl(master, "Auto"),
          headers: commonHeaders,
          subtitles,
          type: "m3u8"
        }
      ];
    }

    return variants.map((v) => ({
      name: `AnimeSalt • AWSStream • ${v.quality} • Multi`,
      url: v.url,
      quality: v.quality,
      headers: commonHeaders,
      subtitles,
      type: "m3u8"
    }));
  } catch (e) {
    warn("extractor:awsstream", e);
    return [];
  }
}

module.exports = {
  extractAwsStream
};
