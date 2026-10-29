const TMDB_BASE_URL = "https://api.themoviedb.org/3";
const DEFAULT_TMDB_KEY = "1865f43a0549ca50d341dd9ab8b29f49";
const USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36";

const HEADERS = {
  "User-Agent": USER_AGENT,
  "Accept": "*/*",
  "Accept-Language": "en-US,en;q=0.9"
};

// Preferred descending order for sorting streams by resolution. Values are
// opaque; higher = better. "Auto" is near-the-top because HLS masters without
// a declared variant are usually 1080p-capable.
const RESOLUTION_ORDER = {
  "2160p": 7,
  "1440p": 6,
  "1080p": 5,
  "720p": 4,
  "480p": 3,
  "360p": 2,
  "240p": 1,
  "144p": 0
};

function warn(context, err) {
  const dbg = typeof globalThis !== "undefined" && globalThis.NUVIO_DEBUG === true;
  if (!dbg) return;
  if (typeof console === "undefined" || typeof console.warn !== "function") return;
  const msg = err && err.message ? err.message : String(err);
  console.warn(`[nuvio:${context}] ${msg}`);
}

function timeoutSignal(ms) {
  try {
    if (typeof AbortSignal !== "undefined" && AbortSignal.timeout) {
      return AbortSignal.timeout(ms);
    }
  } catch (e) { /* ignore */ }
  return undefined;
}

function cleanTitle(str) {
  return (str || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function titleSimilarity(a, b) {
  const cleanA = cleanTitle(a);
  const cleanB = cleanTitle(b);
  if (!cleanA || !cleanB) return 0;
  if (cleanA === cleanB) return 1;
  if (cleanA.includes(cleanB) || cleanB.includes(cleanA)) return 0.8;
  const wordsA = new Set(cleanA.split(" "));
  const wordsB = new Set(cleanB.split(" "));
  let intersection = 0;
  for (const w of wordsA) {
    if (wordsB.has(w)) intersection++;
  }
  return (intersection * 2) / (wordsA.size + wordsB.size);
}

function unpack(code) {
  try {
    const match = code.match(/}\((['"])([\s\S]*?)\1,\s*(\d+),\s*(\d+),\s*(['"])([\s\S]*?)\5\.split\((['"])\|\7\)/);
    if (match) {
      let [_, quote1, p, a, c, quote2, kStr] = match;
      p = p.replace(/\\'/g, "'").replace(/\\"/g, '"').replace(/\\\\/g, "\\");
      const radix = parseInt(a, 10);
      let count = parseInt(c, 10);
      const k = kStr.split("|");
      const e = (c2) =>
        (c2 < radix ? "" : e(Math.floor(c2 / radix))) +
        ((c2 = c2 % radix) > 35 ? String.fromCharCode(c2 + 29) : c2.toString(36));
      const d = {};
      while (count--) {
        d[e(count)] = k[count] || e(count);
      }
      return p.replace(/\b\w+\b/g, (w) => (Object.prototype.hasOwnProperty.call(d, w) ? d[w] : w));
    }
  } catch (e) {
    warn("unpack", e);
  }
  return code;
}

function joinUrl(base, p) {
  if (!p) return base;
  if (p.startsWith("http://") || p.startsWith("https://")) return p;
  if (p.startsWith("//")) return `https:${p}`;
  const b = base.endsWith("/") ? base.slice(0, -1) : base;
  const suffix = p.startsWith("/") ? p : `/${p}`;
  return `${b}${suffix}`;
}

function validateEpisodeInput(seasonNum, episodeNum) {
  const s = Number(seasonNum);
  const e = Number(episodeNum);
  if (!Number.isInteger(s) || s < 1 || s > 9999) return null;
  if (!Number.isInteger(e) || e < 1 || e > 9999) return null;
  return { season: s, episode: e };
}

function heightToQuality(height) {
  if (!Number.isFinite(height) || height <= 0) return null;
  if (height >= 2160) return "2160p";
  if (height >= 1440) return "1440p";
  if (height >= 1080) return "1080p";
  if (height >= 720) return "720p";
  if (height >= 480) return "480p";
  if (height >= 360) return "360p";
  if (height >= 240) return "240p";
  return "144p";
}

function parseHlsMaster(text, baseUrl) {
  if (!text || typeof text !== "string") return [];
  const lines = text.split(/\r?\n/);
  const out = [];
  let masterQuery = "";
  try {
    masterQuery = new URL(baseUrl).search || "";
  } catch (_) { /* ignore */ }
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line || !line.startsWith("#EXT-X-STREAM-INF:")) continue;
    let urlLine = (lines[i + 1] || "").trim();
    if (!urlLine || urlLine.startsWith("#")) continue;
    const resMatch = line.match(/RESOLUTION=(\d+)x(\d+)/i);
    if (!resMatch) continue;
    const bwMatch = line.match(/BANDWIDTH=(\d+)/i);
    const height = parseInt(resMatch[2], 10);
    const bandwidth = bwMatch ? parseInt(bwMatch[1], 10) : 0;
    let resolved;
    try {
      resolved = new URL(urlLine, baseUrl).toString();
    } catch (_) {
      continue;
    }
    if (masterQuery && !resolved.includes("?")) resolved += masterQuery;
    out.push({ url: resolved, resolution: heightToQuality(height), height, bandwidth });
  }
  return out;
}

function hlsAudioTrackCount(text) {
  if (!text || typeof text !== "string") return 0;
  const matches = text.match(/#EXT-X-MEDIA:[^\n]*TYPE=AUDIO/gi);
  return matches ? matches.length : 0;
}

function isRealStreamUrl(url) {
  if (!url || typeof url !== "string") return false;
  if (!url.startsWith("http://") && !url.startsWith("https://")) return false;
  const lowercase = url.toLowerCase();
  if (
    lowercase.includes("/embed/") ||
    lowercase.includes("/embed-") ||
    lowercase.includes("/e/") ||
    lowercase.includes("/play.php") ||
    lowercase.includes("/player.php") ||
    lowercase.includes("abyssplayer.com") ||
    lowercase.includes("short.icu") ||
    lowercase.includes("cloudy.upns.one") ||
    lowercase.includes("vidcloud.upns.ink") ||
    lowercase.includes("filesforever.link") ||
    lowercase.includes("strmup.to") ||
    lowercase.includes("emturbovid.com") ||
    lowercase.includes("animedekho.app") ||
    lowercase.includes("animesalt.cx") ||
    lowercase.includes("youtube.com") ||
    lowercase.includes("youtu.be") ||
    lowercase.includes("vimeo.com") ||
    lowercase.includes(".html") ||
    lowercase.includes(".htm") ||
    lowercase.includes(".php") ||
    lowercase.includes("#")
  ) {
    return false;
  }
  const isHls = lowercase.includes(".m3u8") || lowercase.includes("/hls/");
  const isMp4 = lowercase.includes(".mp4") || lowercase.includes("/sora/") || lowercase.includes("/stream/");
  const isDash = lowercase.includes(".mpd") || lowercase.includes("/dash/");
  return isHls || isMp4 || isDash || lowercase.includes(".mkv");
}

module.exports = {
  TMDB_BASE_URL,
  DEFAULT_TMDB_KEY,
  USER_AGENT,
  HEADERS,
  RESOLUTION_ORDER,
  warn,
  timeoutSignal,
  cleanTitle,
  titleSimilarity,
  unpack,
  joinUrl,
  validateEpisodeInput,
  heightToQuality,
  parseHlsMaster,
  hlsAudioTrackCount,
  isRealStreamUrl
};
