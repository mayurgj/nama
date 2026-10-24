const assert = require("assert");
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const MANIFEST_PATH = path.join(ROOT, "manifest.json");
const BUNDLE_PATH = path.join(ROOT, "providers", "animesalt.js");

// ---------- minimal test harness (serial async queue) ----------
let passed = 0;
let failed = 0;
let skipped = 0;
const queue = [];

function test(name, fn) {
  queue.push(async () => {
    try {
      await fn();
      passed++;
      console.log(`  \u2713 ${name}`);
    } catch (err) {
      failed++;
      console.error(`  \u2717 ${name}\n    ${err && err.stack || err}`);
    }
  });
}

function skip(name, reason) {
  queue.push(async () => {
    skipped++;
    console.log(`  \u2015 ${name} (skipped: ${reason})`);
  });
}

function section(label) {
  queue.push(async () => { console.log(`\n[${label}]`); });
}

async function runQueue() {
  for (const fn of queue) await fn();
}

// ---------- fetch mock harness ----------
const realFetch = global.fetch;
let fetchHandler = null;
global.fetch = async function (url, opts) {
  if (fetchHandler) return fetchHandler(url, opts);
  if (realFetch) return realFetch(url, opts);
  throw new Error("fetch not available");
};
function withFetch(handler, fn) {
  fetchHandler = handler;
  return Promise.resolve(fn()).finally(() => { fetchHandler = null; });
}
function mockRes({ ok = true, status = 200, body = "", json = null, contentType = "text/html" } = {}) {
  return {
    ok,
    status,
    headers: { get: (k) => (k.toLowerCase() === "content-type" ? contentType : null) },
    text: async () => (typeof body === "string" ? body : JSON.stringify(body)),
    json: async () => (json !== null ? json : (typeof body === "string" ? JSON.parse(body) : body))
  };
}

console.log("=== Running Nuvio Providers Plugin Tests ===");

// ---------- 1. Manifest ----------
section("manifest");
test("manifest.json exists and parses", () => {
  assert(fs.existsSync(MANIFEST_PATH), "manifest.json must exist");
  const manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, "utf8"));
  assert(manifest.name, "name present");
  assert(manifest.id, "id present");
  assert(Array.isArray(manifest.scrapers) && manifest.scrapers.length > 0, "scrapers array non-empty");
  const scraper = manifest.scrapers.find((s) => s.id === "animesalt");
  assert(scraper, "animesalt scraper present");
  assert.strictEqual(scraper.filename, "providers/animesalt.js");
  assert(scraper.supportedTypes.includes("movie"));
  assert(scraper.supportedTypes.includes("tv"));
  assert(scraper.formats.includes("m3u8"));
});

// ---------- 2. Utility functions ----------
section("utils");
const {
  cleanTitle,
  titleSimilarity,
  unpack,
  isRealStreamUrl,
  joinUrl,
  validateEpisodeInput,
  parseQualityFromUrl
} = require("../src/constants");

test("cleanTitle strips punctuation and lowercases", () => {
  assert.strictEqual(cleanTitle("Naruto: Shippuuden!"), "naruto shippuuden");
  assert.strictEqual(cleanTitle("Demon Slayer: Kimetsu no Yaiba"), "demon slayer kimetsu no yaiba");
  assert.strictEqual(cleanTitle(""), "");
  assert.strictEqual(cleanTitle(null), "");
});

test("titleSimilarity scores exact/substring/none", () => {
  assert.strictEqual(titleSimilarity("Naruto", "Naruto"), 1);
  assert(titleSimilarity("Demon Slayer", "Demon Slayer: Mugen Train") > 0.5);
  assert.strictEqual(titleSimilarity("", "x"), 0);
  assert.strictEqual(titleSimilarity("abc", "xyz"), 0);
});

test("unpack handles packed code", () => {
  const packed = `eval(function(p,a,c,k,e,d){while(c--)if(k[c])p=p.replace(new RegExp('\\\\b'+e(c)+'\\\\b','g'),k[c]);return p}('0 1="2";',3,3,'var|msg|hello'.split('|')))`;
  assert(unpack(packed).includes('var msg="hello"'));
});

test("unpack returns input unchanged on malformed packed code", () => {
  const notPacked = `console.log("hello")`;
  assert.strictEqual(unpack(notPacked), notPacked);
  assert.strictEqual(unpack(""), "");
});

test("isRealStreamUrl accepts hls/mp4 and rejects embeds/pages", () => {
  assert(isRealStreamUrl("https://example.com/stream/index.m3u8"));
  assert(isRealStreamUrl("https://cdn.example.com/video.mp4"));
  assert(!isRealStreamUrl("https://example.com/embed/123"));
  assert(!isRealStreamUrl("https://animesalt.cx/series/naruto/"));
  assert(!isRealStreamUrl(""));
  assert(!isRealStreamUrl(null));
  assert(!isRealStreamUrl(42));
  assert(!isRealStreamUrl("ftp://example.com/file.mp4"));
});

test("joinUrl handles absolute, protocol-relative, and relative paths", () => {
  assert.strictEqual(joinUrl("https://a.com", "/x"), "https://a.com/x");
  assert.strictEqual(joinUrl("https://a.com/", "/x"), "https://a.com/x");
  assert.strictEqual(joinUrl("https://a.com", "x"), "https://a.com/x");
  assert.strictEqual(joinUrl("https://a.com", "https://b.com/y"), "https://b.com/y");
  assert.strictEqual(joinUrl("https://a.com", "//cdn.b.com/y"), "https://cdn.b.com/y");
  assert.strictEqual(joinUrl("https://a.com", ""), "https://a.com");
});

test("validateEpisodeInput accepts positive ints and rejects garbage", () => {
  assert.deepStrictEqual(validateEpisodeInput(1, 1), { season: 1, episode: 1 });
  assert.deepStrictEqual(validateEpisodeInput("3", "12"), { season: 3, episode: 12 });
  assert.strictEqual(validateEpisodeInput(0, 1), null);
  assert.strictEqual(validateEpisodeInput(1, 0), null);
  assert.strictEqual(validateEpisodeInput(-1, 1), null);
  assert.strictEqual(validateEpisodeInput("abc", 1), null);
  assert.strictEqual(validateEpisodeInput(1.5, 1), null);
  assert.strictEqual(validateEpisodeInput(10000, 1), null);
});

test("parseQualityFromUrl recognises common markers", () => {
  assert.strictEqual(parseQualityFromUrl("https://x/stream/1080p/index.m3u8"), "1080p");
  assert.strictEqual(parseQualityFromUrl("https://x/stream/720/index.m3u8"), "720p");
  assert.strictEqual(parseQualityFromUrl("https://x/video_2160.mp4"), "4K");
  assert.strictEqual(parseQualityFromUrl("https://x/video.4k.mp4"), "4K");
  assert.strictEqual(parseQualityFromUrl("https://x/no-marker/master.m3u8"), "Auto");
  assert.strictEqual(parseQualityFromUrl(null), "Auto");
  assert.strictEqual(parseQualityFromUrl(""), "Auto");
});

// ---------- 3. Exports ----------
section("exports");
const srcProvider = require("../src/index");
test("src/index exports getStreams", () => {
  assert.strictEqual(typeof srcProvider.getStreams, "function");
});
if (fs.existsSync(BUNDLE_PATH)) {
  // Clear require cache: the bundle may have been rebuilt since last run.
  delete require.cache[require.resolve(BUNDLE_PATH)];
  const bundleProvider = require(BUNDLE_PATH);
  test("bundle exports getStreams", () => {
    assert.strictEqual(typeof bundleProvider.getStreams, "function");
  });
} else {
  skip("bundle exports getStreams", "run `node build.js` to generate providers/animesalt.js");
}

// ---------- 4. Extractor negative paths (mocked fetch) ----------
section("extractors (mocked)");
const { extractStreamWish } = require("../src/extractors/streamwish");
const { extractMegaPlay } = require("../src/extractors/megaplay");
const { extractAwsStream } = require("../src/extractors/awsstream");
const { extractAbyss } = require("../src/extractors/abyss");

test("extractStreamWish returns null when response is not ok", () =>
  withFetch(() => mockRes({ ok: false, status: 404 }), async () => {
    const r = await extractStreamWish("https://streamwish.to/e/abc");
    assert.strictEqual(r, null);
  }));

test("extractStreamWish returns null when HTML has no packed JS", () =>
  withFetch(() => mockRes({ ok: true, body: "<html><body>nothing to see</body></html>" }), async () => {
    const r = await extractStreamWish("https://streamwish.to/e/abc");
    assert.strictEqual(r, null);
  }));

test("extractMegaPlay returns [] on initial fetch failure", () =>
  withFetch(() => mockRes({ ok: false, status: 500 }), async () => {
    const r = await extractMegaPlay("https://megaplay.buzz/embed/x");
    assert.deepStrictEqual(r, []);
  }));

test("extractAwsStream returns null when postUrl response is not ok", () => {
  let call = 0;
  return withFetch(() => {
    call++;
    if (call === 1) return mockRes({ ok: true, body: "<html></html>" });
    return mockRes({ ok: false, status: 500 });
  }, async () => {
    const r = await extractAwsStream("https://as-cdn.example/player/abc123");
    assert.strictEqual(r, null);
  });
});

test("extractAbyss returns [] when datas marker is absent", () =>
  withFetch(() => mockRes({ ok: true, body: "<html>no datas here</html>" }), async () => {
    const r = await extractAbyss("https://abyssplayer.com/v/x");
    assert.deepStrictEqual(r, []);
  }));

test("extractAwsStream handles network errors gracefully", () =>
  withFetch(() => { throw new Error("network"); }, async () => {
    const r = await extractAwsStream("https://as-cdn.example/player/abc123");
    assert.strictEqual(r, null);
  }));

// ---------- 5. getStreams input validation ----------
section("getStreams validation");
test("getStreams rejects missing tmdbId", async () => {
  assert.deepStrictEqual(await srcProvider.getStreams(null, "movie"), []);
  assert.deepStrictEqual(await srcProvider.getStreams(undefined, "movie"), []);
});

test("getStreams rejects invalid season/episode for tv", async () => {
  assert.deepStrictEqual(await srcProvider.getStreams(1, "tv", 0, 1), []);
  assert.deepStrictEqual(await srcProvider.getStreams(1, "tv", 1, 0), []);
  assert.deepStrictEqual(await srcProvider.getStreams(1, "tv", "a", "b"), []);
});

// ---------- 6. Network-backed tests (optional) ----------
section("network (optional, --network to enable)");
const runNetwork = process.argv.includes("--network") || process.env.NUVIO_RUN_NETWORK === "1";

async function runNetworkSuite() {
  const { fetchTmdbDetails } = require("../src/tmdb");
  test("TMDB tv fetch", async () => {
    const tv = await fetchTmdbDetails(85937, "tv");
    assert(tv && tv.title && tv.title.length > 0, "expected tv title");
  });
  test("TMDB movie fetch", async () => {
    const mv = await fetchTmdbDetails(372058, "movie");
    assert(mv && mv.title && mv.title.length > 0, "expected movie title");
  });
  test("getStreams returns array end-to-end", async () => {
    const streams = await srcProvider.getStreams(85937, "tv", 1, 1);
    assert(Array.isArray(streams), "must return array");
  });
}

if (runNetwork) {
  runNetworkSuite();
} else {
  skip("TMDB tv fetch", "pass --network or NUVIO_RUN_NETWORK=1");
  skip("TMDB movie fetch", "pass --network or NUVIO_RUN_NETWORK=1");
  skip("getStreams returns array end-to-end", "pass --network or NUVIO_RUN_NETWORK=1");
}

runQueue().then(() => {
  console.log(`\n=== ${passed} passed, ${failed} failed, ${skipped} skipped ===`);
  if (failed > 0) process.exit(1);
});
