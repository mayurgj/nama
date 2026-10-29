const CryptoJS = require("crypto-js");
const cheerio = require("cheerio-without-node-native");
const { HEADERS, warn } = require("../../../shared/constants");
const { formatStream, parseResolution } = require("../../../shared/formatter");

async function extractMegaPlay(url, langName = "Multi") {
  try {
    let streamPageUrl = url;
    if (!url.includes("/stream/s-")) {
      const pageRes = await fetch(url, { headers: HEADERS });
      if (!pageRes.ok) return [];
      const html = await pageRes.text();
      const $ = cheerio.load(html);
      const embedSrc = $("iframe.s5-embed").attr("src");
      if (!embedSrc) return [];
      streamPageUrl = embedSrc;
    }

    const idMatch = streamPageUrl.match(/\/stream\/s-\d+\/(\d+)\//);
    if (!idMatch || !idMatch[1]) return [];
    const id = idMatch[1];
    const origin = new URL(streamPageUrl).origin;

    const apiHeaders = {
      "Accept": "*/*",
      "X-Requested-With": "XMLHttpRequest",
      "Referer": origin,
      "User-Agent": HEADERS["User-Agent"]
    };

    const apiRes = await fetch(`${origin}/stream/getSources?id=${id}`, { headers: apiHeaders });
    if (!apiRes.ok) return [];
    const resJson = await apiRes.json();

    let file = resJson && resJson.sources && resJson.sources.file;
    const enc = resJson && resJson.enc;

    if (!file && enc) {
      // Keys reverse-engineered from the embed client — kept inline so the
      // bundle is self-contained. Rotating them is the vendor's job.
      const keyStr = "i?LMTAx0Q6,:}50U";
      const keyHex = CryptoJS.enc.Utf8.parse(keyStr).toString(CryptoJS.enc.Hex).padEnd(64, "0");
      const key = CryptoJS.enc.Hex.parse(keyHex);
      const iv = CryptoJS.enc.Utf8.parse("W0;27ToaUpl_P%'c");
      const normalized = enc.replace(/-/g, "+").replace(/_/g, "/");
      const padded = normalized + "=".repeat((4 - (normalized.length % 4)) % 4);
      const decrypted = CryptoJS.AES.decrypt(padded, key, {
        iv,
        mode: CryptoJS.mode.CBC,
        padding: CryptoJS.pad.Pkcs7
      });
      const decObj = JSON.parse(decrypted.toString(CryptoJS.enc.Utf8));
      file = decObj && decObj.file;
    }

    if (!file) return [];

    const tokenMatch = file.match(/\/([a-f0-9]{32})\/([a-f0-9]{32})\//i);
    if (tokenMatch && !file.includes("token=")) {
      const secret = "MpCdnT0k3n!9f2K#xQ7vL5mR8wN1pY4s";
      const expires = Math.floor(Date.now() / 1000) + 90;
      const payload = `${expires}|${tokenMatch[1]}/${tokenMatch[2]}`;
      const hash = CryptoJS.HmacSHA256(payload, secret);
      const b64Payload = CryptoJS.enc.Base64.stringify(CryptoJS.enc.Utf8.parse(payload))
        .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
      const b64Sig = CryptoJS.enc.Base64.stringify(hash)
        .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
      const token = `${b64Payload}.${b64Sig}`;
      file = `${file}${file.includes("?") ? "&" : "?"}token=${token}`;
    }

    const subtitles = ((resJson && resJson.tracks) || [])
      .filter((t) => t.file && t.kind !== "thumbnails")
      .map((t) => ({ lang: t.label || "English", url: t.file }));

    const languages = (!langName || langName === "Multi") ? ["multi"] : [langName];

    return [formatStream({
      url: file,
      provider: "animesalt",
      type: "m3u8",
      resolution: parseResolution(file),
      languages,
      headers: {
        "Referer": `${origin}/`,
        "Origin": origin,
        "User-Agent": HEADERS["User-Agent"]
      },
      subtitles
    })];
  } catch (e) {
    warn("extractor:megaplay", e);
    return [];
  }
}

module.exports = {
  extractMegaPlay
};
