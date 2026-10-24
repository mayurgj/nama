const fs = require("fs");
const path = require("path");

const ROOT = __dirname;
const SRC = path.join(ROOT, "src");
const DIST_DIR = path.join(ROOT, "providers");
const OUT_FILE = path.join(DIST_DIR, "animesalt.js");

if (!fs.existsSync(DIST_DIR)) {
  fs.mkdirSync(DIST_DIR, { recursive: true });
}

// Read all parts in dependency order
const constantsCode = fs.readFileSync(path.join(SRC, "constants.js"), "utf8");
const tmdbCode = fs.readFileSync(path.join(SRC, "tmdb.js"), "utf8");
const searchCode = fs.readFileSync(path.join(SRC, "search.js"), "utf8");
const episodesCode = fs.readFileSync(path.join(SRC, "episodes.js"), "utf8");
const awsstreamCode = fs.readFileSync(path.join(SRC, "extractors", "awsstream.js"), "utf8");
const streamwishCode = fs.readFileSync(path.join(SRC, "extractors", "streamwish.js"), "utf8");
const megaplayCode = fs.readFileSync(path.join(SRC, "extractors", "megaplay.js"), "utf8");
const abyssCode = fs.readFileSync(path.join(SRC, "extractors", "abyss.js"), "utf8");
const multilangCode = fs.readFileSync(path.join(SRC, "extractors", "multilang.js"), "utf8");
const indexCode = fs.readFileSync(path.join(SRC, "index.js"), "utf8");

// Strip require statements and module.exports in internal modules to produce a unified bundle
function stripCommonJs(code) {
  return code
    .replace(/const\s+\{[^}]+\}\s*=\s*require\(["'][^"']+["']\);?/g, "")
    .replace(/const\s+\w+\s*=\s*require\(["'][^"']+["']\);?/g, "")
    .replace(/module\.exports\s*=\s*\{[^}]*\};?/g, "")
    .trim();
}

const bundled = `/**
 * AnimeSalt Nuvio Scraper Plugin
 * Compatible with Nuvio App (Mobile & Android TV) and All-in-One-Nuvio
 * Source: https://animesalt.cx/
 * Generated: ${new Date().toISOString()}
 */

var cheerio = typeof require !== 'undefined' ? require('cheerio-without-node-native') : (globalThis.cheerio || {});
var CryptoJS = typeof require !== 'undefined' ? require('crypto-js') : (globalThis.CryptoJS || {});

// --- Constants & Utilities ---
${stripCommonJs(constantsCode)}

// --- TMDB Resolver ---
${stripCommonJs(tmdbCode)}

// --- Search Engine ---
${stripCommonJs(searchCode)}

// --- Episode / Movie Resolver ---
${stripCommonJs(episodesCode)}

// --- Embed Extractors ---
${stripCommonJs(awsstreamCode)}

${stripCommonJs(streamwishCode)}

${stripCommonJs(megaplayCode)}

${stripCommonJs(abyssCode)}

${stripCommonJs(multilangCode)}

// --- Main Scraper Entrypoint ---
${stripCommonJs(indexCode)}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { getStreams };
}
if (typeof globalThis !== 'undefined') {
  globalThis.getStreams = getStreams;
}
`;

fs.writeFileSync(OUT_FILE, bundled, "utf8");
console.log(`Bundle generated successfully at: ${OUT_FILE} (${bundled.length} bytes)`);
