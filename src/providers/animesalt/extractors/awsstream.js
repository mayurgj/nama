const { HEADERS, unpack, parseHlsMaster, hlsAudioTrackCount, warn } = require("../../../shared/constants");
const { formatStream, parseResolution } = require("../../../shared/formatter");

function langLabelToCodes(lang) {
  if (!lang || lang === "Multi") return ["multi"];
  return [lang];
}

async function extractAwsStream(url, langName = "Multi") {
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
    const master = json && json.videoSource;
    if (!master) return [];

    let subtitle = null;
    const packedMatch = html.match(/eval\(function\(p,a,c,k,e,d\)[\s\S]*?\.split\(['"]\|['"]\)/);
    if (packedMatch) {
      const unpacked = unpack(packedMatch[0]);
      const subMatch = unpacked.match(/"kind":\s*"captions"\s*,\s*"file":\s*"(https?:\/\/[^"]+)"/);
      if (subMatch) subtitle = subMatch[1].replace(/\\/g, "");
    }

    const commonHeaders = {
      "Referer": `${origin}/`,
      "Origin": origin,
      "User-Agent": HEADERS["User-Agent"]
    };
    const subtitles = subtitle ? [{ lang: "English", url: subtitle }] : [];
    const languages = langLabelToCodes(langName);

    let variants = [];
    let audioCount = 0;
    try {
      const masterRes = await fetch(master, { headers: commonHeaders });
      if (masterRes.ok) {
        const body = await masterRes.text();
        variants = parseHlsMaster(body, master);
        audioCount = hlsAudioTrackCount(body);
      }
    } catch (e) {
      warn("extractor:awsstream:master", e);
    }

    // Multi-audio master: hand the player the master so the audio-track
    // switcher stays functional. Pick the highest variant resolution we saw.
    if (audioCount >= 2) {
      const bestHeight = variants.reduce((h, v) => (v.height > h ? v.height : h), 0);
      return [formatStream({
        url: master,
        provider: "animesalt",
        type: "m3u8",
        resolution: bestHeight ? parseResolution(null, bestHeight) : null,
        languages: ["multi"],
        headers: commonHeaders,
        subtitles
      })];
    }

    if (variants.length === 0) {
      return [formatStream({
        url: master,
        provider: "animesalt",
        type: "m3u8",
        resolution: parseResolution(master),
        languages,
        headers: commonHeaders,
        subtitles
      })];
    }

    return variants.map((v) => formatStream({
      url: v.url,
      provider: "animesalt",
      type: "m3u8",
      resolution: v.resolution,
      languages,
      headers: commonHeaders,
      subtitles
    }));
  } catch (e) {
    warn("extractor:awsstream", e);
    return [];
  }
}

module.exports = {
  extractAwsStream
};
