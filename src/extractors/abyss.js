const { HEADERS, warn } = require("../constants");

/**
 * Extract streams from an abyssplayer.com / short.icu embed. The embed ships
 * encrypted source data; decryption is delegated to a public helper service.
 * @param {string} url
 * @param {string} [langName]
 * @returns {Promise<Array<import("../index").Stream>>}
 */
async function extractAbyss(url, langName = "Multi") {
  try {
    const cleanUrl = url.replace("https://short.icu", "https://abyssplayer.com");
    const reqHeaders = {
      "User-Agent": HEADERS["User-Agent"],
      "Origin": "https://playhydrax.com",
      "Referer": "https://playhydrax.com/"
    };

    const res = await fetch(cleanUrl, { headers: reqHeaders });
    if (!res.ok) return [];
    const html = await res.text();

    const match = html.match(/const\s+datas\s*=\s*"([^"]*)"/);
    if (!match || !match[1]) return [];

    const decRes = await fetch("https://enc-dec.app/api/dec-abyss", {
      method: "POST",
      headers: {
        ...reqHeaders,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ text: match[1] })
    });

    if (!decRes.ok) return [];
    const decData = await decRes.json();
    const sources = decData?.result?.sources || [];

    return sources
      .filter((s) => s && s.url && s.status)
      .map((s) => {
        const codec = (s.codec || "MP4").toUpperCase();
        const quality = s.type || "720p";
        return {
          name: `AnimeSalt [Abyss] [${langName}] (${codec} ${quality})`,
          url: s.url,
          quality,
          headers: {
            // Hydrax CDN only serves bytes to clients coming from the abyssplayer
            // embed origin — a playhydrax Referer gets a cf-cached 404.
            "Referer": "https://player.abyssplayer.com/",
            "Origin": "https://player.abyssplayer.com",
            "User-Agent": HEADERS["User-Agent"]
          },
          type: s.url.includes(".m3u8") ? "m3u8" : "mp4"
        };
      });
  } catch (e) {
    warn("extractor:abyss", e);
    return [];
  }
}

module.exports = {
  extractAbyss
};
