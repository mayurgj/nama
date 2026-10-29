/**
 * AnimeSalt Nuvio Scraper Plugin
 * Compatible with Nuvio App (Mobile & Android TV) and All-in-One-Nuvio
 * Source: https://animesalt.cx/
 * Generated: 2026-10-29T14:14:10.603Z
 */

var cheerio = typeof require !== 'undefined' ? require('cheerio-without-node-native') : (globalThis.cheerio || {});
var CryptoJS = typeof require !== 'undefined' ? require('crypto-js') : (globalThis.CryptoJS || {});

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

// AnimeSalt-specific base URL. All shared helpers live in src/shared/.
const MAIN_URL = "https://animesalt.cx";

function parseResults($, selector) {
  const out = [];
  $(selector).each((_, el) => {
    const title = $(el).find("h2.entry-title, header h2, .entry-title").first().text().trim();
    const href = $(el).find("a.lnk-blk").attr("href") || $(el).find("a").first().attr("href");
    if (title && href) {
      out.push({ title, href: joinUrl(MAIN_URL, href) });
    }
  });
  return out;
}

async function searchDirect(query) {
  try {
    const url = `${MAIN_URL}/?s=${encodeURIComponent(query)}`;
    const res = await fetch(url, { headers: HEADERS });
    if (!res.ok) return [];
    const html = await res.text();
    const $ = cheerio.load(html);
    return parseResults($, "article.post, li.hentry");
  } catch (e) {
    warn("search:direct", e);
    return [];
  }
}

async function searchAjax(query) {
  try {
    const body = `action=torofilm_infinite_scroll&page=1&per_page=16&query_type=search&query_args[s]=${encodeURIComponent(query)}`;
    const res = await fetch(`${MAIN_URL}/wp-admin/admin-ajax.php`, {
      method: "POST",
      headers: {
        ...HEADERS,
        "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
        "X-Requested-With": "XMLHttpRequest",
        "Referer": `${MAIN_URL}/`
      },
      body
    });
    if (!res.ok) return [];
    const json = await res.json();
    if (!json || !json.success || !json.data || !json.data.content) return [];
    const $ = cheerio.load(json.data.content);
    return parseResults($, "article, li");
  } catch (e) {
    warn("search:ajax", e);
    return [];
  }
}

async function searchAnimeSalt(query) {
  const direct = await searchDirect(query);
  if (direct.length > 0) return direct;
  return searchAjax(query);
}

async function tryQueries(queries) {
  for (const q of queries) {
    if (!q) continue;
    const res = await searchAnimeSalt(q);
    if (res.length > 0) return res;
  }
  return [];
}

async function findBestMatch(tmdbDetails, mediaType) {
  if (!tmdbDetails || !tmdbDetails.title) return null;

  const seen = new Set();
  const queries = [];
  const push = (q) => {
    if (!q) return;
    const key = q.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    queries.push(q);
  };
  push(tmdbDetails.title);
  push(cleanTitle(tmdbDetails.title));
  for (const alias of (tmdbDetails.aliases || []).slice(0, 3)) {
    push(alias);
    push(cleanTitle(alias));
  }

  const allResults = await tryQueries(queries);
  if (allResults.length === 0) return null;

  const unique = [];
  const seenHrefs = new Set();
  for (const item of allResults) {
    if (item.href && !seenHrefs.has(item.href)) {
      seenHrefs.add(item.href);
      unique.push(item);
    }
  }

  let bestMatch = null;
  let highestScore = -1;

  for (const item of unique) {
    let score = titleSimilarity(tmdbDetails.title, item.title);
    if (score < 0.9 && tmdbDetails.aliases && tmdbDetails.aliases.length) {
      for (const alias of tmdbDetails.aliases) {
        const aliasScore = titleSimilarity(alias, item.title);
        if (aliasScore > score) score = aliasScore;
      }
    }
    if (mediaType === "movie") {
      if (item.href.includes("/movies/")) score += 0.15;
      if (item.href.includes("/series/")) score -= 0.1;
    } else if (mediaType === "tv") {
      if (item.href.includes("/series/")) score += 0.15;
      if (item.href.includes("/movies/")) score -= 0.1;
    }
    if (score > highestScore) {
      highestScore = score;
      bestMatch = item;
    }
  }

  return bestMatch || unique[0];
}

async function resolveEpisodeUrl(seriesUrl, seasonNum, episodeNum, showTitle) {
  try {
    const res = await fetch(seriesUrl, { headers: HEADERS });
    if (!res.ok) return null;
    const html = await res.text();
    const $ = cheerio.load(html);

    let seasonBtn = $(`div.season-buttons a[data-season="${seasonNum}"]`);
    if (seasonBtn.length === 0) {
      seasonBtn = $(`a[data-season="${seasonNum}"]`);
    }

    let postId = seasonBtn.length ? seasonBtn.attr("data-post") : null;
    if (!postId) {
      const anyBtn = $("div.season-buttons a[data-post]").first();
      if (anyBtn.length) postId = anyBtn.attr("data-post");
    }

    const dataSeason = seasonNum;

    if (postId) {
      const epRes = await fetch(`${MAIN_URL}/wp-admin/admin-ajax.php`, {
        method: "POST",
        headers: {
          ...HEADERS,
          "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
          "X-Requested-With": "XMLHttpRequest",
          "Referer": seriesUrl
        },
        body: `action=action_select_season&season=${dataSeason}&post=${postId}`
      });

      if (epRes.ok) {
        const epHtml = await epRes.text();
        const $ep = cheerio.load(epHtml);
        const epArticles = $ep("li article, article.post, li");
        let targetEp = null;

        const epStr = String(episodeNum);
        const epPad = episodeNum < 10 ? `0${episodeNum}` : epStr;
        const epPats = [
          { pat: `x${epStr}`, boundary: true },
          { pat: `x${epPad}`, boundary: true },
          { pat: `e${epStr}`, boundary: true },
          { pat: `e${epPad}`, boundary: true },
          { pat: `episode ${epStr}`, boundary: false },
          { pat: `episode ${epPad}`, boundary: false },
          { pat: `ep ${epStr}`, boundary: false },
          { pat: `ep ${epPad}`, boundary: false },
          { pat: `ep-${epStr}`, boundary: true },
          { pat: `-${epStr}/`, boundary: false },
          { pat: `-${epPad}/`, boundary: false }
        ];

        function patMatch(text, pattern, needBoundary) {
          const idx = text.indexOf(pattern);
          if (idx === -1) return false;
          if (!needBoundary) return true;
          const after = idx + pattern.length;
          if (after >= text.length) return true;
          const ch = text.charCodeAt(after);
          return ch < 48 || ch > 57;
        }

        epArticles.each((idx, el) => {
          const epText = $ep(el).find("h2.entry-title, .entry-title, .num-epi").text().toLowerCase();
          const href = $ep(el).find("a").first().attr("href");
          if (!href) return;
          const hrefLower = href.toLowerCase();
          for (const { pat, boundary } of epPats) {
            if (patMatch(epText, pat, boundary) || patMatch(hrefLower, pat, boundary)) {
              targetEp = href;
              return false;
            }
          }
        });

        if (!targetEp && epArticles.length >= episodeNum) {
          targetEp = $ep(epArticles[episodeNum - 1]).find("a").first().attr("href");
        }

        if (targetEp) return joinUrl(MAIN_URL, targetEp);
      }
    }

    const directLinks = [];
    $("a").each((_, el) => {
      const href = $(el).attr("href") || "";
      if (href.includes("/episode/") || href.includes("/episodes/")) {
        directLinks.push({ href, text: $(el).text() });
      }
    });

    const epStr2 = String(episodeNum);
    const epPad2 = episodeNum < 10 ? `0${episodeNum}` : epStr2;
    const directPats = [
      { pat: `x${epStr2}`, boundary: true },
      { pat: `x${epPad2}`, boundary: true },
      { pat: `episode-${epStr2}`, boundary: true },
      { pat: `episode-${epPad2}`, boundary: true },
      { pat: `episode ${epStr2}`, boundary: false },
      { pat: `episode ${epPad2}`, boundary: false },
      { pat: `ep-${epStr2}`, boundary: true },
      { pat: `ep-${epPad2}`, boundary: true }
    ];

    function patMatch2(text, pattern, needBoundary) {
      const idx = text.indexOf(pattern);
      if (idx === -1) return false;
      if (!needBoundary) return true;
      const after = idx + pattern.length;
      if (after >= text.length) return true;
      const ch = text.charCodeAt(after);
      return ch < 48 || ch > 57;
    }

    for (const item of directLinks) {
      const lower = `${item.href} ${item.text}`.toLowerCase();
      for (const { pat, boundary } of directPats) {
        if (patMatch2(lower, pat, boundary)) {
          return joinUrl(MAIN_URL, item.href);
        }
      }
    }

    if (directLinks.length >= episodeNum) {
      return joinUrl(MAIN_URL, directLinks[episodeNum - 1].href);
    }

    return null;
  } catch (e) {
    warn("episodes:resolve", e);
    return null;
  }
}

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
    const languages = (!langName || langName === "Multi") ? ["multi"] : [langName];

    return formatStream({
      url: fileMatch[1],
      provider: "animesalt",
      type: "m3u8",
      resolution: parseResolution(fileMatch[1]),
      languages,
      headers: {
        "Referer": `${origin}/`,
        "Origin": origin,
        "User-Agent": HEADERS["User-Agent"]
      }
    });
  } catch (e) {
    warn("extractor:streamwish", e);
    return null;
  }
}

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

// Keep only HD+ resolutions. Null (resolution unknown) is kept because HLS
// masters without a declared variant are usually 1080p-capable.
const HD_PLUS = new Set(["2160p", "1440p", "1080p", null]);

const EXTRACTOR_ROUTES = [
  {
    name: "multilang",
    match: (u) => /\/(?:multi-lang-)?plyr\/player\.php\?/.test(u),
    run: async (iframeUrl) => {
      try {
        const dataParam = new URL(iframeUrl).searchParams.get("data");
        if (!dataParam) return [];
        const res = await extractMultiLang(dataParam);
        return Array.isArray(res) ? res : [];
      } catch (e) {
        warn("route:multilang", e);
        return [];
      }
    }
  },
  {
    name: "awsstream",
    match: (u) =>
      u.includes("as-cdn") ||
      u.includes("awstream") ||
      u.includes("zephyrflick") ||
      u.includes("ravok.buzz"),
    run: async (iframeUrl) => {
      const r = await extractAwsStream(iframeUrl);
      return Array.isArray(r) ? r : [];
    }
  },
  {
    name: "megaplay",
    match: (u) => u.includes("megaplay.buzz") || u.includes("rapid-cloud.co"),
    run: async (iframeUrl) => {
      const r = await extractMegaPlay(iframeUrl);
      return Array.isArray(r) ? r : [];
    }
  },
  {
    name: "streamwish",
    match: (u) =>
      u.includes("pixdrive") ||
      u.includes("ghbrisk") ||
      u.includes("streamwish") ||
      u.includes("filesim"),
    run: async (iframeUrl) => {
      const r = await extractStreamWish(iframeUrl);
      return r ? [r] : [];
    }
  }
];

function routeIframe(iframeUrl) {
  for (const route of EXTRACTOR_ROUTES) {
    if (route.match(iframeUrl)) return route.run(iframeUrl);
  }
  return Promise.resolve([]);
}

function collectIframeUrls($page) {
  const urls = new Set();
  $page("iframe").each((_, el) => {
    const src = $page(el).attr("data-src") || $page(el).attr("src");
    if (!src || src.startsWith("about:") || src.startsWith("javascript:")) return;
    urls.add(joinUrl(MAIN_URL, src));
  });
  $page("[data-embed], [data-src], [data-player]").each((_, el) => {
    const data = $page(el).attr("data-embed") || $page(el).attr("data-player");
    if (data && data.startsWith("http")) urls.add(data);
  });
  return urls;
}

async function isPlayableStream(stream) {
  if (!isRealStreamUrl(stream && stream.url)) return false;
  try {
    const headers = {
      "User-Agent": HEADERS["User-Agent"],
      ...(stream.headers || {}),
      "Range": "bytes=0-10"
    };
    const res = await fetch(stream.url, {
      headers,
      signal: AbortSignal.timeout(3500)
    });
    if (!res.ok && res.status !== 206) return false;
    const contentType = res.headers.get("content-type") || "";
    if (contentType.includes("text/html")) return false;
    return true;
  } catch (e) {
    warn("probe", e);
    return false;
  }
}

async function getStreams(tmdbId, mediaType = "movie", seasonNum = 1, episodeNum = 1) {
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

    const bestMatch = await findBestMatch(details, mediaType);
    if (!bestMatch || !bestMatch.href) return [];

    let targetUrl = bestMatch.href;
    if (mediaType === "tv") {
      const epUrl = await resolveEpisodeUrl(bestMatch.href, season, episode, details.title);
      if (epUrl) targetUrl = epUrl;
    }

    const pageRes = await fetch(targetUrl, { headers: HEADERS });
    if (!pageRes.ok) return [];
    const $page = cheerio.load(await pageRes.text());

    const iframeUrls = collectIframeUrls($page);
    const results = await Promise.allSettled(
      Array.from(iframeUrls).map((u) => routeIframe(u))
    );

    const seasonEpisode = mediaType === "tv"
      ? normalizeSeasonEpisode({ season, episode })
      : null;

    const seen = new Set();
    const candidates = [];
    for (const r of results) {
      if (r.status !== "fulfilled" || !Array.isArray(r.value)) continue;
      for (const stream of r.value) {
        if (!stream || !stream.url || seen.has(stream.url)) continue;
        if (!isRealStreamUrl(stream.url)) continue;
        if (!HD_PLUS.has(stream.resolution)) continue;
        seen.add(stream.url);
        if (seasonEpisode) stream.seasonEpisode = seasonEpisode;
        candidates.push(stream);
      }
    }

    const probed = await Promise.all(
      candidates.map(async (s) => ({ s, ok: await isPlayableStream(s) }))
    );
    const playable = probed.filter((r) => r.ok).map((r) => r.s);
    const final = playable.length > 0 ? playable : candidates;

    return final.sort((a, b) => {
      const qA = RESOLUTION_ORDER[a.resolution] != null ? RESOLUTION_ORDER[a.resolution] : -1;
      const qB = RESOLUTION_ORDER[b.resolution] != null ? RESOLUTION_ORDER[b.resolution] : -1;
      return qB - qA;
    });
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
