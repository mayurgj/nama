const fs = require("fs");
const path = require("path");

const ROOT = __dirname;
const SRC = path.join(ROOT, "src");
const DIST_DIR = path.join(ROOT, "providers");

if (!fs.existsSync(DIST_DIR)) {
  fs.mkdirSync(DIST_DIR, { recursive: true });
}

function stripCommonJs(code) {
  return code
    .replace(/const\s+\{[^}]+\}\s*=\s*require\(["'][^"']+["']\);?/g, "")
    .replace(/const\s+\w+\s*=\s*require\(["'][^"']+["']\);?/g, "")
    .replace(/if\s*\(\s*typeof\s+module\s*!==\s*["']undefined["']\s*&&\s*module\.exports\s*\)\s*\{[\s\S]*?\n\}/g, "")
    .replace(/if\s*\(\s*typeof\s+globalThis\s*!==\s*["']undefined["']\s*\)\s*\{[\s\S]*?\n\}/g, "")
    .replace(/module\.exports\s*=\s*\{[^}]*\};?/g, "")
    .trim();
}

function prelude(needsCryptoJs) {
  const lines = [
    `var cheerio = typeof require !== 'undefined' ? require('cheerio-without-node-native') : (globalThis.cheerio || {});`
  ];
  if (needsCryptoJs) {
    lines.push(`var CryptoJS = typeof require !== 'undefined' ? require('crypto-js') : (globalThis.CryptoJS || {});`);
  }
  return lines.join("\n");
}

const UMD_FOOTER = `
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { getStreams };
}
if (typeof globalThis !== 'undefined') {
  globalThis.getStreams = getStreams;
}
`;

function bundleProvider({ id, sources, outFile, header, needsCryptoJs }) {
  const parts = sources.map((rel) =>
    stripCommonJs(fs.readFileSync(path.join(SRC, rel), "utf8"))
  );
  const bundled = `${header}\n\n${prelude(needsCryptoJs)}\n\n${parts.join("\n\n")}\n${UMD_FOOTER}`;
  fs.writeFileSync(outFile, bundled, "utf8");
  console.log(`Bundle ${id} → ${outFile} (${bundled.length} bytes)`);
}

const SHARED = [
  "shared/constants.js",
  "shared/formatter.js",
  "shared/tmdb.js"
];

bundleProvider({
  id: "animesalt",
  needsCryptoJs: true,
  header: `/**
 * AnimeSalt Nuvio Scraper Plugin
 * Compatible with Nuvio App (Mobile & Android TV) and All-in-One-Nuvio
 * Source: https://animesalt.cx/
 * Generated: ${new Date().toISOString()}
 */`,
  sources: [
    ...SHARED,
    "providers/animesalt/constants.js",
    "providers/animesalt/search.js",
    "providers/animesalt/episodes.js",
    "providers/animesalt/extractors/awsstream.js",
    "providers/animesalt/extractors/streamwish.js",
    "providers/animesalt/extractors/megaplay.js",
    "providers/animesalt/extractors/multilang.js",
    "providers/animesalt/index.js"
  ],
  outFile: path.join(DIST_DIR, "animesalt.js")
});

bundleProvider({
  id: "multimovies",
  needsCryptoJs: false,
  header: `/**
 * MultiMovies Nuvio Scraper Plugin
 * Compatible with Nuvio App (Mobile & Android TV) and All-in-One-Nuvio
 * Source: https://multimovies.wtf/ (resolves to current mirror)
 * Generated: ${new Date().toISOString()}
 */`,
  sources: [
    ...SHARED,
    "providers/multimovies/constants.js",
    "providers/multimovies/search.js",
    "providers/multimovies/extractors/vidrift.js",
    "providers/multimovies/extractors/vidout.js",
    "providers/multimovies/extractors/cineverse.js",
    "providers/multimovies/extractors/vidbolt.js",
    "providers/multimovies/extractors/filmu.js",
    "providers/multimovies/index.js"
  ],
  outFile: path.join(DIST_DIR, "multimovies.js")
});
