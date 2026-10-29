/**
 * MultiMovies Nuvio Scraper Plugin
 * Compatible with Nuvio App (Mobile & Android TV) and All-in-One-Nuvio
 * Source: https://multimovies.wtf/ (resolves to current mirror)
 * Generated: 2026-10-29T14:14:10.639Z
 */

var cheerio = typeof require !== 'undefined' ? require('cheerio-without-node-native') : (globalThis.cheerio || {});

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

// ─── Resolution ───────────────────────────────────────────────────────────
// Returns the Nuvio-canonical label or null. Prefers an explicit pixel
// height (HLS already told us) over text parsing.
function parseResolution(text, hintHeight) {
  if (hintHeight != null) {
    const q = heightToQuality(hintHeight);
    if (q) return q;
  }
  if (!text || typeof text !== "string") return null;
  const t = text.toLowerCase();
  if (/(?:^|[^0-9])(?:2160p?|4k|uhd)(?:[^0-9a-z]|$)/.test(t)) return "2160p";
  if (/(?:^|[^0-9])(?:1440p?|2k|qhd)(?:[^0-9a-z]|$)/.test(t)) return "1440p";
  if (/(?:^|[^0-9])(?:1080p?|fhd)(?:[^0-9a-z]|$)/.test(t)) return "1080p";
  if (/(?:^|[^0-9])(?:720p?|hd)(?:[^0-9a-z]|$)/.test(t)) return "720p";
  if (/(?:^|[^0-9])480p?(?:[^0-9]|$)/.test(t)) return "480p";
  if (/(?:^|[^0-9])360p?(?:[^0-9]|$)/.test(t)) return "360p";
  return null;
}

// ─── Quality ──────────────────────────────────────────────────────────────
// Source label (BluRay Remux, WEB-DL, HDRip …). First match wins; most
// specific patterns are tested first so "BluRay Remux" doesn't collapse to
// "BluRay" and "HC HDRip" doesn't collapse to "HDRip".
const QUALITY_PATTERNS = [
  { re: /bluray[\s._-]*remux\b|\bremux\b/i, q: "BluRay Remux" },
  { re: /\b(?:bluray|bdrip|brrip|bd[\s._-]?rip)\b/i, q: "BluRay" },
  { re: /\bweb[\s._-]*dl\b|\bwebdl\b/i, q: "WEB-DL" },
  { re: /\bweb[\s._-]*rip\b|\bwebrip\b/i, q: "WEBRip" },
  { re: /\bweb\b/i, q: "WEB-DL" },
  { re: /\b(?:hc[\s._-]*hdrip|hardcoded[\s._-]*hdrip)\b/i, q: "HC HDRip" },
  { re: /\bhdrip\b/i, q: "HDRip" },
  { re: /\bdvdrip\b/i, q: "DVDRip" },
  { re: /\bhdtv\b/i, q: "HDTV" },
  { re: /\b(?:camrip|hdcam)\b/i, q: "CAMRip" },
  { re: /\bcam\b/i, q: "CAM" },
  { re: /\btelesync\b|\bts\b/i, q: "TS" }
];
function parseQuality(text) {
  if (!text || typeof text !== "string") return null;
  for (const { re, q } of QUALITY_PATTERNS) {
    if (re.test(text)) return q;
  }
  return null;
}

// ─── Encode (video codec) ─────────────────────────────────────────────────
function parseEncode(text) {
  if (!text || typeof text !== "string") return null;
  if (/\b(?:x[\s._-]?265|h[\s._-]?265|hevc)\b/i.test(text)) return "x265";
  if (/\b(?:x[\s._-]?264|h[\s._-]?264|avc)\b/i.test(text)) return "x264";
  if (/\bav1\b/i.test(text)) return "AV1";
  if (/\bvp9\b/i.test(text)) return "VP9";
  return null;
}

// ─── Visual tags ──────────────────────────────────────────────────────────
// HDR hierarchy: HDR10+ wins over HDR10 wins over HDR. DV and HLG are
// independent. Returns a deduped array.
function parseVisualTags(text) {
  if (!text || typeof text !== "string") return [];
  const out = [];
  if (/\b(?:dolby[\s._-]*vision|dovi|dv)\b/i.test(text)) out.push("DV");
  if (/\bhlg\b/i.test(text)) out.push("HLG");
  if (/\bhdr[\s._-]*10\s*\+|\bhdr10\+/i.test(text)) out.push("HDR10+");
  else if (/\bhdr10\b/i.test(text)) out.push("HDR10");
  else if (/\bhdr\b/i.test(text)) out.push("HDR");
  return out;
}

// ─── Audio tags ───────────────────────────────────────────────────────────
// Tests are independent — a release can be TrueHD + Atmos. Order matters
// only inside the DD/DD+ family: match DDP/EAC3/DD+ before plain DD/AC3.
function parseAudioTags(text) {
  if (!text || typeof text !== "string") return [];
  const out = [];
  if (/\batmos\b/i.test(text)) out.push("Atmos");
  if (/\btruehd\b|\btrue[\s._-]*hd\b/i.test(text)) out.push("TrueHD");
  if (/\bdts[\s._-]*hd[\s._-]*ma\b/i.test(text)) out.push("DTS-HD MA");
  else if (/\bdts[\s._-]*hd\b/i.test(text)) out.push("DTS-HD");
  if (/\bdts[\s._-]*x\b/i.test(text)) out.push("DTS-X");
  if (/\bdts(?![\s._-]*(?:hd|x))\b/i.test(text)) out.push("DTS");
  // DD+ family (DDP, DD+, EAC3, E-AC3): don't require trailing \b — release
  // titles glue the channel count straight onto the codec ("DDP5.1").
  if (/\b(?:ddp|dd\+|eac3|e[\s._-]*ac3)/i.test(text)) out.push("DD+");
  else if (/\b(?:dd|ac3)\b/i.test(text)) out.push("DD");
  if (/\baac\b/i.test(text)) out.push("AAC");
  if (/\bflac\b/i.test(text)) out.push("FLAC");
  if (/\bopus\b/i.test(text)) out.push("Opus");
  if (/\bmp3\b/i.test(text)) out.push("MP3");
  return Array.from(new Set(out));
}

// ─── Audio channels ───────────────────────────────────────────────────────
function parseAudioChannels(text) {
  if (!text || typeof text !== "string") return [];
  const seen = new Set();
  // Match N.M channel notation. Can't rely on \b because release titles glue
  // the number straight to the codec ("DDP5.1"); exclude only neighbouring
  // digits so "v2.0.1"-style version strings don't trip the parser.
  const re = /(?<!\d)([2578])\.([01])(?!\d)/g;
  let m;
  while ((m = re.exec(text)) !== null) {
    seen.add(`${m[1]}.${m[2]}`);
  }
  // "2.0" fallback: a "Stereo" marker alone counts as 2.0.
  if (seen.size === 0 && /\bstereo\b/i.test(text)) seen.add("2.0");
  return Array.from(seen);
}

// ─── Languages ────────────────────────────────────────────────────────────
// Maps language words (and a few common abbreviations) to ISO 639-1 codes.
// "Multi" / "Multi Audio" / "Multi-Audio" / "Dual Audio" are passed through
// as themselves since the Nuvio template renders them specially.
const LANG_MAP = [
  ["hi", /\bhindi\b|\bhin\b/i],
  ["ta", /\btamil\b|\btam\b/i],
  ["te", /\btelugu\b|\btel\b/i],
  ["kn", /\bkannada\b|\bkan\b/i],
  ["ml", /\bmalayalam\b|\bmal\b/i],
  ["bn", /\bbengali\b|\bben\b/i],
  ["mr", /\bmarathi\b/i],
  ["pa", /\bpunjabi\b/i],
  ["gu", /\bgujarati\b/i],
  ["en", /\benglish\b|\beng\b/i],
  ["ja", /\bjapanese\b|\bjap\b|\bjpn\b/i],
  ["ko", /\bkorean\b|\bkor\b/i],
  ["zh", /\bchinese\b|\bmandarin\b/i],
  ["es", /\bspanish\b|\bspa\b|\besp\b/i],
  ["fr", /\bfrench\b|\bfre\b|\bfra\b/i],
  ["de", /\bgerman\b|\bger\b|\bdeu\b/i],
  ["it", /\bitalian\b|\bita\b/i],
  ["pt", /\bportuguese\b|\bpor\b/i],
  ["ru", /\brussian\b|\brus\b/i],
  ["ar", /\barabic\b/i],
  ["tr", /\bturkish\b/i]
];
function parseLanguages(text) {
  if (!text || typeof text !== "string") return [];
  const out = [];
  if (/\bmulti[\s._-]*audio\b|\bmulti\b/i.test(text)) out.push("multi");
  if (/\bdual[\s._-]*audio\b|\bdual\b/i.test(text)) out.push("dual");
  if (/\bdubbed\b|\bdub\b/i.test(text)) out.push("dub");
  for (const [code, re] of LANG_MAP) {
    if (re.test(text)) out.push(code);
  }
  return Array.from(new Set(out));
}

// ─── Release group ────────────────────────────────────────────────────────
// Trailing "-GROUP" before extension, or "[Group]"/"(Group)" wrapper.
function parseReleaseGroup(text) {
  if (!text || typeof text !== "string") return null;
  const stripped = text.replace(/\.(?:mkv|mp4|avi|m4v|webm|mov|ts)$/i, "");
  const trailing = stripped.match(/-([A-Za-z0-9]{2,})\s*$/);
  if (trailing) return trailing[1];
  const bracket = text.match(/[\[(]([A-Za-z0-9][A-Za-z0-9._-]{1,})[\])]/);
  if (bracket) return bracket[1];
  return null;
}

// ─── Size ─────────────────────────────────────────────────────────────────
// Accepts a number (bytes), or a human string like "1.2 GB" / "800MB".
const SIZE_UNITS = { b: 1, kb: 1024, mb: 1024 ** 2, gb: 1024 ** 3, tb: 1024 ** 4 };
function parseSize(input) {
  if (input == null) return null;
  if (typeof input === "number" && Number.isFinite(input) && input >= 0) return input;
  if (typeof input !== "string") return null;
  const m = input.trim().match(/^([\d.]+)\s*(b|kb|mb|gb|tb)\b/i);
  if (!m) {
    const asNum = Number(input);
    return Number.isFinite(asNum) && asNum >= 0 ? asNum : null;
  }
  const unit = SIZE_UNITS[m[2].toLowerCase()];
  const value = parseFloat(m[1]);
  if (!unit || !Number.isFinite(value)) return null;
  return Math.round(value * unit);
}

// ─── Delivery type ────────────────────────────────────────────────────────
function detectType(url) {
  if (!url || typeof url !== "string") return null;
  const u = url.toLowerCase().split("?")[0];
  if (u.endsWith(".m3u8") || u.endsWith(".m3u") || u.includes("/hls/")) return "m3u8";
  if (u.endsWith(".mpd") || u.includes("/dash/")) return "mpd";
  if (u.endsWith(".mkv")) return "mkv";
  if (u.endsWith(".mp4") || u.includes("/sora/") || u.includes("/stream/")) return "mp4";
  return null;
}

// ─── Season / episode ─────────────────────────────────────────────────────
// Normalises a {season,episode} pair or an already-formatted ["S01","E05"]
// into the canonical padded pair.
function normalizeSeasonEpisode(input) {
  if (!input) return null;
  if (Array.isArray(input) && input.length === 2) {
    const [s, e] = input;
    if (typeof s === "string" && typeof e === "string") return [s, e];
  }
  if (typeof input === "object" && input.season != null && input.episode != null) {
    const s = Number(input.season);
    const e = Number(input.episode);
    if (!Number.isFinite(s) || !Number.isFinite(e)) return null;
    const pad = (n) => (n < 10 ? `0${n}` : String(n));
    return [`S${pad(s)}`, `E${pad(e)}`];
  }
  return null;
}

// ─── formatStream ─────────────────────────────────────────────────────────
// The universal entry point. Every extractor in every provider calls this
// and returns the result unchanged. Explicit args always win over parsed
// values — pass what the embed told you, leave the rest for the parsers.
function formatStream(input) {
  if (!input || !input.url || !input.provider) {
    throw new Error("formatStream requires at least { url, provider }");
  }
  const title = input.title || "";
  const type = input.type || detectType(input.url) || "m3u8";

  const resolution = input.resolution != null
    ? input.resolution
    : parseResolution(title, input.height);

  const quality = input.quality != null ? input.quality : parseQuality(title);
  const encode = input.encode != null ? input.encode : parseEncode(title);
  const visualTags = input.visualTags != null ? input.visualTags : parseVisualTags(title);
  const audioTags = input.audioTags != null ? input.audioTags : parseAudioTags(title);
  const audioChannels = input.audioChannels != null ? input.audioChannels : parseAudioChannels(title);
  const languages = input.languages != null ? input.languages : parseLanguages(title);
  const releaseGroup = input.releaseGroup != null ? input.releaseGroup : parseReleaseGroup(title);
  const size = parseSize(input.size);
  const bitrate = input.bitrate != null && Number.isFinite(Number(input.bitrate))
    ? Number(input.bitrate)
    : null;
  const seasonEpisode = normalizeSeasonEpisode(input.seasonEpisode);

  return {
    url: input.url,
    provider: input.provider,
    type,
    resolution,
    quality,
    encode,
    visualTags: Array.isArray(visualTags) ? visualTags : [],
    audioTags: Array.isArray(audioTags) ? audioTags : [],
    audioChannels: Array.isArray(audioChannels) ? audioChannels : [],
    languages: Array.isArray(languages) ? languages : [],
    releaseGroup,
    size,
    bitrate,
    seasonEpisode,
    title: title || null,
    headers: input.headers || null,
    subtitles: Array.isArray(input.subtitles) ? input.subtitles : []
  };
}

async function fetchTmdbDetails(tmdbId, mediaType, userApiKey) {
  const apiKey = userApiKey || DEFAULT_TMDB_KEY;
  let resolvedId = tmdbId;

  if (typeof tmdbId === "string" && tmdbId.trim().toLowerCase().startsWith("tt")) {
    try {
      const findUrl = `${TMDB_BASE_URL}/find/${tmdbId.trim()}?api_key=${apiKey}&external_source=imdb_id`;
      const findRes = await fetch(findUrl, { headers: HEADERS, signal: timeoutSignal(8000) });
      if (findRes && findRes.ok) {
        const findData = await findRes.json();
        const results = mediaType === "tv" ? findData.tv_results : findData.movie_results;
        if (results && results.length > 0) {
          resolvedId = results[0].id;
        }
      }
    } catch (e) {
      warn("tmdb:find", e);
    }
  }

  try {
    const endpoint = mediaType === "movie" ? "movie" : "tv";
    const url = `${TMDB_BASE_URL}/${endpoint}/${resolvedId}?api_key=${apiKey}&append_to_response=alternative_titles,external_ids`;
    const res = await fetch(url, { headers: HEADERS, signal: timeoutSignal(8000) });
    if (!res || !res.ok) return null;
    const data = await res.json();

    const title = mediaType === "movie"
      ? data.title || data.original_title
      : data.name || data.original_name;
    const originalTitle = mediaType === "movie" ? data.original_title : data.original_name;

    const releaseDate = data.release_date || data.first_air_date || "";
    const year = parseInt(releaseDate.substring(0, 4), 10) || null;

    const aliases = new Set();
    if (originalTitle && originalTitle !== title) aliases.add(originalTitle);

    const altList = (data.alternative_titles && (data.alternative_titles.titles || data.alternative_titles.results)) || [];
    for (const alt of altList) {
      const altTitle = alt.title || alt.name;
      if (altTitle && altTitle.trim()) aliases.add(altTitle.trim());
    }

    return {
      id: resolvedId,
      title: (title || "").trim(),
      originalTitle: (originalTitle || "").trim(),
      aliases: Array.from(aliases),
      year,
      imdbId: (data.external_ids && data.external_ids.imdb_id) || null
    };
  } catch (e) {
    warn("tmdb:details", e);
    return null;
  }
}

const DOMAIN_RESOLVER = "https://multimovies.wtf/";
const DEFAULT_MIRROR = "https://m1.multimovies.courses";
const MIRROR_TTL_MS = 30 * 60 * 1000;
const VIDOUT_GITHUB_BASE = "https://raw.githubusercontent.com/Watchout2025/api/refs/heads/main";

// Short in-memory cache for the resolved mirror. Multimovies rotates domains
// — we re-check at most every 30 minutes rather than every scrape.
let MIRROR_CACHE = { url: null, exp: 0 };

async function resolveMirror() {
  const now = Date.now();
  if (MIRROR_CACHE.url && MIRROR_CACHE.exp > now) return MIRROR_CACHE.url;
  let found = DEFAULT_MIRROR;
  try {
    const res = await fetch(DOMAIN_RESOLVER, { headers: HEADERS, signal: timeoutSignal(6000) });
    if (res && res.ok) {
      const html = await res.text();
      // The pointer page exposes several buttons/CTAs; cta-primary is the
      // canonical "Visit MultiMovies". Fall back to any multimovies-ish link.
      const m = html.match(/<a[^>]+class="[^"]*cta-primary[^"]*"[^>]+href="([^"]+)"/i)
        || html.match(/<a[^>]+href="(https?:\/\/[^"]*multimovies[^"]*)"[^>]*class="[^"]*cta-primary[^"]*"/i)
        || html.match(/<a[^>]+href="(https?:\/\/m\d*\.multimovies\.[a-z]+[^"]*)"/i);
      if (m && m[1]) found = m[1].replace(/\/+$/, "");
    }
  } catch (e) {
    warn("resolveMirror", e);
  }
  MIRROR_CACHE = { url: found, exp: now + MIRROR_TTL_MS };
  return found;
}

// Extract the top-level JSON object that follows `needle = ` in a script
// blob — matches balanced braces so we don't need a monster regex.
function extractJsonAssignment(html, needle) {
  const i = html.indexOf(needle);
  if (i === -1) return null;
  const start = html.indexOf("{", i);
  if (start === -1) return null;
  let depth = 0;
  let inStr = false;
  let strCh = "";
  let escape = false;
  for (let j = start; j < html.length; j++) {
    const ch = html[j];
    if (inStr) {
      if (escape) { escape = false; continue; }
      if (ch === "\\") { escape = true; continue; }
      if (ch === strCh) { inStr = false; }
      continue;
    }
    if (ch === '"' || ch === "'") { inStr = true; strCh = ch; continue; }
    if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) {
        try { return JSON.parse(html.substring(start, j + 1)); }
        catch (e) { warn(`extractJson:${needle}`, e); return null; }
      }
    }
  }
  return null;
}

async function searchMultimovies(mirror, query) {
  try {
    const res = await fetch(
      `${mirror}/search?q=${encodeURIComponent(query)}`,
      { headers: HEADERS, signal: timeoutSignal(10000) }
    );
    if (!res || !res.ok) return [];
    const html = await res.text();
    const $ = cheerio.load(html);
    const out = [];
    const seen = new Set();
    $("a").each((_, el) => {
      const href = $(el).attr("href") || "";
      if (!(href.indexOf("/movie/") === 0 || href.indexOf("/series/") === 0)) return;
      const clean = href.split("#")[0].split("?")[0];
      if (seen.has(clean)) return;
      const title = $(el).attr("aria-label") || $(el).attr("title") || $(el).text().trim();
      if (!title) return;
      seen.add(clean);
      out.push({ title: title.trim(), href: `${mirror}${clean}` });
    });
    return out;
  } catch (e) {
    warn("search", e);
    return [];
  }
}

async function findBestMatch(mirror, details, mediaType) {
  if (!details || !details.title) return null;

  const queries = [];
  const qSeen = new Set();
  const pushQ = (q) => {
    if (!q) return;
    const k = q.toLowerCase();
    if (qSeen.has(k)) return;
    qSeen.add(k);
    queries.push(q);
  };
  pushQ(details.title);
  pushQ(cleanTitle(details.title));
  (details.aliases || []).slice(0, 3).forEach((a) => { pushQ(a); pushQ(cleanTitle(a)); });

  let all = [];
  for (const q of queries) {
    const r = await searchMultimovies(mirror, q);
    if (r && r.length) { all = r; break; }
  }
  if (!all.length) return null;

  let best = null;
  let bestScore = -1;
  for (const item of all) {
    let score = titleSimilarity(details.title, item.title);
    if (score < 0.9 && details.aliases) {
      for (const alias of details.aliases) {
        const s2 = titleSimilarity(alias, item.title);
        if (s2 > score) score = s2;
      }
    }
    if (mediaType === "movie") {
      if (item.href.indexOf("/movie/") !== -1) score += 0.15;
      if (item.href.indexOf("/series/") !== -1) score -= 0.1;
    } else if (mediaType === "tv") {
      if (item.href.indexOf("/series/") !== -1) score += 0.15;
      if (item.href.indexOf("/movie/") !== -1) score -= 0.1;
    }
    if (score > bestScore) { bestScore = score; best = item; }
  }
  return best || all[0];
}

function buildEpisodeUrl(seriesUrl, season, episode) {
  const clean = seriesUrl.replace(/\/+$/, "");
  return `${clean}/season/${season}/episode/${episode}`;
}

async function fetchWatchConfig(pageUrl) {
  try {
    const res = await fetch(pageUrl, { headers: HEADERS, signal: timeoutSignal(12000) });
    if (!res || !res.ok) return null;
    const html = await res.text();
    return extractJsonAssignment(html, "watchConfig");
  } catch (e) {
    warn("fetchWatchConfig", e);
    return null;
  }
}

async function extractVidrift(iframeUrl) {
  try {
    const res = await fetch(iframeUrl, {
      headers: {
        ...HEADERS,
        "Referer": "https://m1.multimovies.courses/",
        "Sec-Fetch-Dest": "iframe"
      },
      signal: timeoutSignal(10000)
    });
    if (!res || !res.ok) return [];
    const html = await res.text();
    const meta = extractJsonAssignment(html, "embedMeta");
    if (!meta || !Array.isArray(meta.orionStreams)) return [];

    let origin;
    try { origin = new URL(iframeUrl).origin; }
    catch (e) { origin = "https://embed.vidrift.net"; }

    const streamHeaders = {
      "Referer": `${origin}/`,
      "Origin": origin,
      "User-Agent": USER_AGENT
    };

    return meta.orionStreams.map((s) => {
      const relUrl = s.url || "";
      const absUrl = relUrl.indexOf("http") === 0 ? relUrl : `${origin}${relUrl}`;
      let topHeight = 0;
      if (Array.isArray(s.rungs)) {
        for (const r of s.rungs) {
          const h = Number(r && r.height);
          if (Number.isFinite(h) && h > topHeight) topHeight = h;
        }
      }
      const resolution = heightToQuality(topHeight);
      // "Orion · Hindi" / "Orion · Original" — the right-hand side is the
      // audio-track label we hand to the language parser.
      const langLabel = String(s.name || "").replace(/^Orion\s*·\s*/i, "").trim() || "Original";
      return formatStream({
        url: absUrl,
        provider: "multimovies",
        type: "m3u8",
        resolution,
        title: langLabel,
        headers: streamHeaders
      });
    }).filter((s) => s.url && s.url.indexOf("http") === 0);
  } catch (e) {
    warn("extractor:vidrift", e);
    return [];
  }
}

async function extractVidout(details, mediaType, season, episode) {
  try {
    const tmdbNumericId = details && details.id;
    if (!tmdbNumericId) return [];

    const lookupUrl = mediaType === "movie"
      ? `${VIDOUT_GITHUB_BASE}/hls/movie/${tmdbNumericId}`
      : `${VIDOUT_GITHUB_BASE}/hls/tv/${tmdbNumericId}/S${season}.json`;

    const res = await fetch(lookupUrl, {
      headers: { "User-Agent": USER_AGENT, "Accept": "text/plain, application/json;q=0.8, */*;q=0.1" },
      signal: timeoutSignal(10000)
    });
    if (!res || !res.ok) return [];

    let streamUrl = null;
    if (mediaType === "movie") {
      streamUrl = (await res.text()).trim();
    } else {
      const jsonText = await res.text();
      let map;
      try { map = JSON.parse(jsonText); }
      catch (e) { warn("vidout:json", e); return []; }
      streamUrl = map && map[String(episode)] ? String(map[String(episode)]).trim() : "";
    }

    if (!streamUrl) return [];
    // The GitHub repo intentionally returns 200 with empty body or `.txt`
    // sentinels for missing entries — treat them as unresolved.
    const lower = streamUrl.toLowerCase();
    if (streamUrl.indexOf("http") !== 0) return [];
    if (lower.indexOf("#") !== -1) return [];
    if (lower.indexOf(".m3u8") === -1 && lower.indexOf("master") === -1 && lower.indexOf("/hls") === -1) {
      return [];
    }

    return [formatStream({
      url: streamUrl,
      provider: "multimovies",
      type: "m3u8",
      resolution: "720p",
      languages: ["multi"],
      headers: {
        "Referer": "https://vidout.pages.dev/",
        "Origin": "https://vidout.pages.dev",
        "User-Agent": USER_AGENT
      }
    })];
  } catch (e) {
    warn("extractor:vidout", e);
    return [];
  }
}

async function extractVidaraByFilecode(filecode) {
  try {
    const res = await fetch("https://gasobni.com/api/stream", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Accept": "application/json, text/plain, */*",
        "Origin": "https://gasobni.com",
        "Referer": `https://gasobni.com/e/${filecode}`,
        "User-Agent": USER_AGENT
      },
      body: JSON.stringify({ filecode, device: "web", codecs: [] }),
      signal: timeoutSignal(10000)
    });
    if (!res || !res.ok) return null;
    const data = await res.json();
    if (!data || !data.streaming_url) return null;
    return data;
  } catch (e) {
    warn("extractor:vidara", e);
    return null;
  }
}

async function extractCineverse(iframeUrl) {
  try {
    const res = await fetch(iframeUrl, {
      headers: {
        ...HEADERS,
        "Referer": "https://m1.multimovies.courses/",
        "Sec-Fetch-Dest": "iframe"
      },
      signal: timeoutSignal(12000)
    });
    if (!res || !res.ok) return [];
    const html = await res.text();

    // Scan every element with both data-url and data-platform. Only vidara
    // is routed today — the others need per-host JS execution.
    const subEmbeds = [];
    const re = /<[^>]*data-url="([^"]+)"[^>]*data-platform="([^"]+)"/gi;
    let m;
    while ((m = re.exec(html)) !== null) {
      subEmbeds.push({ url: m[1].replace(/&amp;/g, "&"), platform: m[2].toLowerCase() });
    }

    const out = [];
    for (const sub of subEmbeds) {
      if (sub.platform !== "vidara") continue;
      const fcMatch = sub.url.match(/\/e\/([A-Za-z0-9_-]+)/);
      if (!fcMatch) continue;
      const filecode = fcMatch[1];
      const payload = await extractVidaraByFilecode(filecode);
      if (!payload || !payload.streaming_url) continue;
      out.push(formatStream({
        url: payload.streaming_url,
        provider: "multimovies",
        type: "m3u8",
        // vidara payload titles look like "Jailer-2.2026.1080p.HEVC.Hindi-Tamil.x265"
        // — rich enough for the formatter to extract resolution/encode/audio/langs.
        title: payload.title || "",
        headers: {
          "Referer": "https://gasobni.com/",
          "Origin": "https://gasobni.com",
          "User-Agent": USER_AGENT
        }
      }));
    }
    return out;
  } catch (e) {
    warn("extractor:cineverse", e);
    return [];
  }
}

async function extractVidbolt(iframeUrl, details, mediaType, season, episode) {
  try {
    const tmdbId = details && details.id;
    if (!tmdbId) return [];
    let api = `https://vidbolt.xyz/api/resolve?type=${mediaType === "tv" ? "tv" : "movie"}&id=${tmdbId}`;
    if (mediaType === "tv") api += `&s=${season}&e=${episode}`;

    const res = await fetch(api, {
      headers: {
        ...HEADERS,
        "Accept": "application/json, text/plain, */*",
        "Referer": iframeUrl,
        "Origin": "https://vidbolt.xyz"
      },
      signal: timeoutSignal(10000)
    });
    if (!res || !res.ok) return [];
    const data = await res.json();
    if (!data || !data.stream || !Array.isArray(data.stream.sources)) return [];

    return data.stream.sources.map((src) => {
      if (!src || !src.url) return null;
      const resolution = src.quality || parseResolution(src.url);
      const languages = src.language ? parseLanguages(String(src.language)) : [];
      return formatStream({
        url: String(src.url),
        provider: "multimovies",
        type: src.kind === "mp4" ? "mp4" : "m3u8",
        resolution,
        languages,
        title: src.title || src.url,
        headers: {
          "Referer": "https://vidbolt.xyz/",
          "Origin": "https://vidbolt.xyz",
          "User-Agent": USER_AGENT
        }
      });
    }).filter(Boolean);
  } catch (e) {
    warn("extractor:vidbolt", e);
    return [];
  }
}

async function extractFilmu(iframeUrl) {
  try {
    const res = await fetch(iframeUrl, {
      headers: {
        ...HEADERS,
        "Referer": "https://m1.multimovies.courses/",
        "Sec-Fetch-Dest": "iframe"
      },
      redirect: "follow",
      signal: timeoutSignal(15000)
    });
    if (!res || !res.ok) return [];
    const finalUrl = res.url || iframeUrl;
    const html = await res.text();

    const m = html.match(/https:\/\/proxy\.streamrip\.fun\/m\/[A-Za-z0-9_\-]+(?:\?[^"'\\\s<>]*)?/);
    if (!m) return [];
    let streamUrl = m[0];
    if (streamUrl.indexOf("f=.m3u8") === -1 && streamUrl.indexOf(".m3u8") === -1) {
      streamUrl = `${streamUrl}${streamUrl.indexOf("?") === -1 ? "?" : "&"}f=.m3u8`;
    }

    let origin;
    try { origin = new URL(finalUrl).origin; }
    catch (e) { origin = "https://vidly.pro"; }

    return [formatStream({
      url: streamUrl,
      provider: "multimovies",
      type: "m3u8",
      languages: ["multi"],
      headers: {
        "Referer": `${origin}/`,
        "Origin": origin,
        "User-Agent": USER_AGENT
      }
    })];
  } catch (e) {
    warn("extractor:filmu", e);
    return [];
  }
}

function routeServer(server, details, mediaType, season, episode) {
  if (!server || !server.url) return Promise.resolve([]);
  const url = String(server.url);
  if (url.indexOf("vidrift.net") !== -1) return extractVidrift(url);
  if (url.indexOf("vidout.pages.dev") !== -1) return extractVidout(details, mediaType, season, episode);
  if (url.indexOf("modiplay.") !== -1) return extractCineverse(url);
  if (url.indexOf("vidbolt.xyz") !== -1) return extractVidbolt(url, details, mediaType, season, episode);
  if (url.indexOf("filmu.in") !== -1 || url.indexOf("vidly.pro") !== -1) return extractFilmu(url);
  // iqsmartgames/moviesnexus need session-aware or Cloudflare-interactive
  // handling; no extractor yet.
  return Promise.resolve([]);
}

async function getStreams(tmdbId, mediaType, seasonNum, episodeNum) {
  if (!mediaType) mediaType = "movie";
  if (seasonNum == null) seasonNum = 1;
  if (episodeNum == null) episodeNum = 1;
  try {
    if (!tmdbId) return [];

    let season = 1;
    let episode = 1;
    if (mediaType === "tv") {
      const v = validateEpisodeInput(seasonNum, episodeNum);
      if (!v) {
        warn("getStreams", `invalid season/episode: ${seasonNum}/${episodeNum}`);
        return [];
      }
      season = v.season;
      episode = v.episode;
    }

    const details = await fetchTmdbDetails(tmdbId, mediaType);
    if (!details || !details.title) return [];

    const mirror = await resolveMirror();
    const match = await findBestMatch(mirror, details, mediaType);
    if (!match || !match.href) return [];

    const pageUrl = mediaType === "tv"
      ? buildEpisodeUrl(match.href, season, episode)
      : match.href;

    let config = await fetchWatchConfig(pageUrl);
    // Series landing pages carry S1E1 by default — if the explicit episode
    // URL ever misses, fall back to the series landing.
    if (!config && mediaType === "tv") {
      config = await fetchWatchConfig(match.href);
    }
    if (!config || !Array.isArray(config.initialServers)) return [];

    const seasonEpisode = mediaType === "tv"
      ? normalizeSeasonEpisode({ season, episode })
      : null;

    const batches = await Promise.allSettled(
      config.initialServers.map((s) => routeServer(s, details, mediaType, season, episode))
    );

    const seen = new Set();
    const candidates = [];
    for (const b of batches) {
      if (b.status !== "fulfilled" || !Array.isArray(b.value)) continue;
      for (const stream of b.value) {
        if (!stream || !stream.url || seen.has(stream.url)) continue;
        seen.add(stream.url);
        if (seasonEpisode) stream.seasonEpisode = seasonEpisode;
        candidates.push(stream);
      }
    }

    candidates.sort((a, b) => {
      const qa = RESOLUTION_ORDER[a.resolution] != null ? RESOLUTION_ORDER[a.resolution] : -1;
      const qb = RESOLUTION_ORDER[b.resolution] != null ? RESOLUTION_ORDER[b.resolution] : -1;
      return qb - qa;
    });

    return candidates;
  } catch (e) {
    warn("getStreams", e);
    return [];
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { getStreams };
}
if (typeof globalThis !== 'undefined') {
  globalThis.getStreams = getStreams;
}
