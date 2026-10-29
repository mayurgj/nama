const { HEADERS, timeoutSignal, warn } = require("../../shared/constants");

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

module.exports = {
  DOMAIN_RESOLVER,
  DEFAULT_MIRROR,
  VIDOUT_GITHUB_BASE,
  resolveMirror,
  extractJsonAssignment
};
