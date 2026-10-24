const MAIN_URL = "https://animesalt.cx";
const TMDB_BASE_URL = "https://api.themoviedb.org/3";
const DEFAULT_TMDB_KEY = "1865f43a0549ca50d341dd9ab8b29f49";
const USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36";

const HEADERS = {
  "User-Agent": USER_AGENT,
  "Accept": "*/*",
  "Accept-Language": "en-US,en;q=0.9"
};

/**
 * Logger that is silent by default. Enable by setting globalThis.NUVIO_DEBUG = true.
 * Centralising this means catch blocks keep failing gracefully without littering host logs.
 */
function warn(context, err) {
  const dbg = typeof globalThis !== "undefined" && globalThis.NUVIO_DEBUG === true;
  if (!dbg) return;
  if (typeof console === "undefined" || typeof console.warn !== "function") return;
  const msg = err && err.message ? err.message : String(err);
  console.warn(`[nuvio:${context}] ${msg}`);
}

/**
 * Normalize a title for comparison: lowercase, strip punctuation, collapse whitespace.
 * @param {string} str
 * @returns {string}
 */
function cleanTitle(str) {
  return (str || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Rough string similarity in [0, 1] based on cleaned-title word overlap.
 * @param {string} a
 * @param {string} b
 * @returns {number}
 */
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

/**
 * Reverse Dean Edwards' p.a.c.k.e.r. Returns the original code if the input
 * isn't packed or unpacking fails.
 * @param {string} code
 * @returns {string}
 */
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

/**
 * Join a base URL with a path. Preserves absolute URLs and promotes
 * protocol-relative (//host) to https.
 * @param {string} base
 * @param {string} p
 * @returns {string}
 */
function joinUrl(base, p) {
  if (!p) return base;
  if (p.startsWith("http://") || p.startsWith("https://")) return p;
  if (p.startsWith("//")) return `https:${p}`;
  const b = base.endsWith("/") ? base.slice(0, -1) : base;
  const suffix = p.startsWith("/") ? p : `/${p}`;
  return `${b}${suffix}`;
}

/**
 * Validate season/episode inputs. Returns null when either is not a positive integer.
 * @param {number|string} seasonNum
 * @param {number|string} episodeNum
 * @returns {{season: number, episode: number} | null}
 */
function validateEpisodeInput(seasonNum, episodeNum) {
  const s = Number(seasonNum);
  const e = Number(episodeNum);
  if (!Number.isInteger(s) || s < 1 || s > 9999) return null;
  if (!Number.isInteger(e) || e < 1 || e > 9999) return null;
  return { season: s, episode: e };
}

const QUALITY_PATTERNS = [
  { re: /(?:^|[^0-9])2160p?(?:[^0-9]|$)|(?:^|[^a-z0-9])4k(?:[^a-z0-9]|$)/i, q: "4K" },
  { re: /(?:^|[^0-9])1440p?(?:[^0-9]|$)|(?:^|[^a-z0-9])2k(?:[^a-z0-9]|$)/i, q: "1440p" },
  { re: /(?:^|[^0-9])1080p?(?:[^0-9]|$)|(?:^|[^a-z0-9])fhd(?:[^a-z0-9]|$)/i, q: "1080p" },
  { re: /(?:^|[^0-9])720p?(?:[^0-9]|$)|(?:^|[^a-z0-9])hd(?:[^a-z0-9]|$)/i, q: "720p" },
  { re: /(?:^|[^0-9])480p?(?:[^0-9]|$)/i, q: "480p" },
  { re: /(?:^|[^0-9])360p?(?:[^0-9]|$)/i, q: "360p" }
];

/**
 * Best-effort quality extraction from a stream URL or filename. m3u8 master
 * playlists usually have no quality marker, so "Auto" is the honest default.
 * @param {string} url
 * @param {string} fallback
 * @returns {string}
 */
function parseQualityFromUrl(url, fallback = "Auto") {
  if (!url || typeof url !== "string") return fallback;
  for (const { re, q } of QUALITY_PATTERNS) {
    if (re.test(url)) return q;
  }
  return fallback;
}

/**
 * Map an HLS variant's pixel height to our quality label.
 * @param {number} height
 * @returns {string}
 */
function heightToQuality(height) {
  if (!Number.isFinite(height) || height <= 0) return "Auto";
  if (height >= 2160) return "4K";
  if (height >= 1440) return "1440p";
  if (height >= 1080) return "1080p";
  if (height >= 720) return "720p";
  if (height >= 480) return "480p";
  if (height >= 360) return "360p";
  if (height >= 240) return "240p";
  return "144p";
}

/**
 * Parse an HLS master playlist into a list of variant streams. Resolves
 * relative variant URLs against the master URL and carries forward the
 * master's query string when the variant has none — most signed-URL
 * schemes (CloudFront, Hydrax-style) need the token re-attached.
 * @param {string} text    Master playlist body
 * @param {string} baseUrl Master playlist URL (for relative resolution)
 * @returns {Array<{url: string, quality: string, height: number, bandwidth: number}>}
 */
function parseHlsMaster(text, baseUrl) {
  if (!text || typeof text !== "string") return [];
  const lines = text.split(/\r?\n/);
  const out = [];
  let masterQuery = "";
  try {
    masterQuery = new URL(baseUrl).search || "";
  } catch (_) {
    /* ignore */
  }
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
    out.push({ url: resolved, quality: heightToQuality(height), height, bandwidth });
  }
  return out;
}

/**
 * True iff `url` looks like a direct playable media URL (not an embed page).
 * @param {unknown} url
 * @returns {boolean}
 */
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
  MAIN_URL,
  TMDB_BASE_URL,
  DEFAULT_TMDB_KEY,
  USER_AGENT,
  HEADERS,
  warn,
  cleanTitle,
  titleSimilarity,
  unpack,
  joinUrl,
  validateEpisodeInput,
  parseQualityFromUrl,
  heightToQuality,
  parseHlsMaster,
  isRealStreamUrl
};
