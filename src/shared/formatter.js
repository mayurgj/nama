const { heightToQuality } = require("./constants");

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

module.exports = {
  formatStream,
  parseResolution,
  parseQuality,
  parseEncode,
  parseVisualTags,
  parseAudioTags,
  parseAudioChannels,
  parseLanguages,
  parseReleaseGroup,
  parseSize,
  detectType,
  normalizeSeasonEpisode
};
