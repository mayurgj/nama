const { warn } = require("../../../shared/constants");
const { extractAwsStream } = require("./awsstream");
const { extractStreamWish } = require("./streamwish");
const { extractMegaPlay } = require("./megaplay");

const LANG_ROUTES = [
  {
    match: (u) =>
      u.includes("as-cdn") ||
      u.includes("awstream") ||
      u.includes("zephyrflick") ||
      u.includes("ravok.buzz"),
    run: (link, lang) => extractAwsStream(link, lang)
  },
  {
    match: (u) => u.includes("megaplay.buzz") || u.includes("rapid-cloud.co"),
    run: (link, lang) => extractMegaPlay(link, lang)
  },
  {
    match: (u) =>
      u.includes("pixdrive") ||
      u.includes("ghbrisk") ||
      u.includes("streamwish") ||
      u.includes("filesim"),
    run: async (link, lang) => {
      const s = await extractStreamWish(link, lang);
      return s ? [s] : [];
    }
  }
];

async function extractMultiLang(dataParam) {
  try {
    let decodedStr = "";
    if (typeof atob === "function") {
      decodedStr = atob(dataParam);
    } else {
      decodedStr = Buffer.from(dataParam, "base64").toString("utf-8");
    }

    const list = JSON.parse(decodedStr);
    if (!Array.isArray(list)) return [];

    const streamPromises = list.map(async (item) => {
      const lang = item.language || "Multi";
      const link = item.link;
      if (!link) return [];
      const route = LANG_ROUTES.find((r) => r.match(link));
      if (!route) return [];
      const res = await route.run(link, lang);
      return Array.isArray(res) ? res : [];
    });

    const results = await Promise.all(streamPromises);
    return results.flat();
  } catch (e) {
    warn("extractor:multilang", e);
    return [];
  }
}

module.exports = {
  extractMultiLang
};
