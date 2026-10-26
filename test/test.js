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

test("manifest contains multimovies scraper entry", () => {
  const manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, "utf8"));
  const mm = manifest.scrapers.find((s) => s.id === "multimovies");
  assert(mm, "multimovies scraper present");
  assert.strictEqual(mm.filename, "providers/multimovies.js");
  assert(mm.supportedTypes.includes("movie"));
  assert(mm.supportedTypes.includes("tv"));
  assert(mm.formats.includes("m3u8"));
  assert(fs.existsSync(path.join(ROOT, mm.filename)), "multimovies provider file exists");
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
  parseQualityFromUrl,
  heightToQuality,
  parseHlsMaster,
  hlsAudioTrackCount
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

test("heightToQuality maps pixel heights to labels", () => {
  assert.strictEqual(heightToQuality(2160), "4K");
  assert.strictEqual(heightToQuality(1440), "1440p");
  assert.strictEqual(heightToQuality(1080), "1080p");
  assert.strictEqual(heightToQuality(720), "720p");
  assert.strictEqual(heightToQuality(480), "480p");
  assert.strictEqual(heightToQuality(240), "240p");
  assert.strictEqual(heightToQuality(0), "Auto");
  assert.strictEqual(heightToQuality(NaN), "Auto");
});

test("parseHlsMaster extracts variants and carries master query", () => {
  const master = "https://cdn.example/hls/abc/master.m3u8?md5=TOKEN&expires=99";
  const body = [
    "#EXTM3U",
    "#EXT-X-STREAM-INF:BANDWIDTH=5000000,RESOLUTION=1920x1080",
    "1080/index.m3u8",
    "#EXT-X-STREAM-INF:BANDWIDTH=2500000,RESOLUTION=1280x720",
    "720/index.m3u8"
  ].join("\n");
  const variants = parseHlsMaster(body, master);
  assert.strictEqual(variants.length, 2);
  assert.strictEqual(variants[0].quality, "1080p");
  assert.ok(variants[0].url.endsWith("1080/index.m3u8?md5=TOKEN&expires=99"));
  assert.strictEqual(variants[1].quality, "720p");
});

test("parseHlsMaster returns [] for empty or non-string input", () => {
  assert.deepStrictEqual(parseHlsMaster("", "https://x/m.m3u8"), []);
  assert.deepStrictEqual(parseHlsMaster(null, "https://x/m.m3u8"), []);
});

test("hlsAudioTrackCount counts EXT-X-MEDIA audio entries", () => {
  const body = [
    "#EXTM3U",
    "#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID=\"a\",NAME=\"English\"",
    "#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID=\"a\",NAME=\"Hindi\"",
    "#EXT-X-MEDIA:TYPE=SUBTITLES,NAME=\"English\""
  ].join("\n");
  assert.strictEqual(hlsAudioTrackCount(body), 2);
  assert.strictEqual(hlsAudioTrackCount(""), 0);
  assert.strictEqual(hlsAudioTrackCount(null), 0);
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

test("extractAwsStream returns [] when postUrl response is not ok", () => {
  let call = 0;
  return withFetch(() => {
    call++;
    if (call === 1) return mockRes({ ok: true, body: "<html></html>" });
    return mockRes({ ok: false, status: 500 });
  }, async () => {
    const r = await extractAwsStream("https://as-cdn.example/player/abc123");
    assert.deepStrictEqual(r, []);
  });
});

test("extractAwsStream handles network errors gracefully", () =>
  withFetch(() => { throw new Error("network"); }, async () => {
    const r = await extractAwsStream("https://as-cdn.example/player/abc123");
    assert.deepStrictEqual(r, []);
  }));

// ---------- 4b. MultiMovies provider (mocked fetch) ----------
section("multimovies (mocked)");
delete require.cache[require.resolve("../providers/multimovies")];
const mmProvider = require("../providers/multimovies");

test("multimovies exports getStreams", () => {
  assert.strictEqual(typeof mmProvider.getStreams, "function");
});

test("multimovies getStreams rejects missing tmdbId", async () => {
  assert.deepStrictEqual(await mmProvider.getStreams(null, "movie"), []);
  assert.deepStrictEqual(await mmProvider.getStreams(undefined, "movie"), []);
});

test("multimovies getStreams rejects invalid tv season/episode", async () => {
  assert.deepStrictEqual(await mmProvider.getStreams(1234139, "tv", 0, 1), []);
  assert.deepStrictEqual(await mmProvider.getStreams(1234139, "tv", 1, 0), []);
  assert.deepStrictEqual(await mmProvider.getStreams(1234139, "tv", "a", "b"), []);
});

test("multimovies getStreams returns [] when TMDB lookup fails", () =>
  withFetch(() => mockRes({ ok: false, status: 500 }), async () => {
    const r = await mmProvider.getStreams(1234139, "movie");
    assert.deepStrictEqual(r, []);
  }));

test("multimovies end-to-end movie flow with mocked network", () => {
  // Script the full pipeline: TMDB → mirror pointer → search → movie page
  // (with watchConfig listing Vidrift+VIDOUT+Cineverse) → per-embed extractors.
  const vidriftHtml = `<html><body><script>
    var embedMeta = {
      "orionStreams":[
        {"name":"Orion · Original","url":"/hls/abc/master.m3u8","rungs":[{"height":1080}]},
        {"name":"Orion · Hindi","url":"/hls/hin/master.m3u8","rungs":[{"height":720}]}
      ]
    };
  </script></body></html>`;
  const cineverseHtml = `<html><body>
    <div data-url="https://vidara.to/e/XYZCODE1" data-platform="vidara"></div>
    <div data-url="https://multimoviesshg.com/e/abc" data-platform="streamhg"></div>
  </body></html>`;
  const watchConfigHtml = `<html><body><script>const watchConfig = {
    "titleId":1,"season":1,"episode":1,"initialServers":[
      {"id":"a1","name":"Cineverse","type":"iframe","url":"https://rozgarlelo.modiplay.xyz/embed/tmdb/movie?id=1234139"},
      {"id":"a2","name":"Vidrift","type":"iframe","url":"https://embed.vidrift.net/embed/movie/1234139"},
      {"id":"a3","name":"VIDOUT","type":"iframe","url":"https://vidout.pages.dev/movie/tt33318732"}
    ]};</script></body></html>`;

  return withFetch(async (url) => {
    url = String(url);
    if (url.indexOf("api.themoviedb.org") !== -1) {
      return mockRes({ ok: true, json: { id: 1234139, title: "Jailer 2", original_title: "Jailer 2", release_date: "2026-07-01", external_ids: { imdb_id: "tt33318732" }, alternative_titles: { titles: [] } } });
    }
    if (url.indexOf("multimovies.wtf") !== -1) {
      return mockRes({ ok: true, body: `<a class="cta-primary" href="https://m1.multimovies.courses">Visit</a>` });
    }
    if (url.indexOf("/search") !== -1) {
      return mockRes({ ok: true, body: `<a href="/movie/jailer-2" title="Jailer 2">Jailer 2</a>` });
    }
    if (url.indexOf("/movie/jailer-2") !== -1) {
      return mockRes({ ok: true, body: watchConfigHtml });
    }
    if (url.indexOf("embed.vidrift.net") !== -1) {
      return mockRes({ ok: true, body: vidriftHtml });
    }
    if (url.indexOf("rozgarlelo.modiplay.xyz") !== -1) {
      return mockRes({ ok: true, body: cineverseHtml });
    }
    if (url.indexOf("gasobni.com/api/stream") !== -1) {
      return mockRes({ ok: true, json: { filecode: "XYZCODE1", streaming_url: "https://cdn.example/hls/XYZCODE1/master.m3u8?token=t", title: "Jailer-2.2026.1080p.HEVC.Hindi-Tamil.x265" } });
    }
    if (url.indexOf("raw.githubusercontent.com/Watchout2025") !== -1) {
      return mockRes({ ok: true, body: "https://cdn.example/vidout/jailer2/master.m3u8" });
    }
    return mockRes({ ok: false, status: 404 });
  }, async () => {
    const streams = await mmProvider.getStreams(1234139, "movie");
    assert(Array.isArray(streams) && streams.length >= 3, "expected at least 3 streams, got " + streams.length);
    const providers = streams.map((s) => s.name);
    assert(providers.some((n) => n.includes("Vidrift")), "has Vidrift stream");
    assert(providers.some((n) => n.includes("Cineverse")), "has Cineverse stream");
    assert(providers.some((n) => n.includes("VIDOUT")), "has VIDOUT stream");
    streams.forEach((s) => {
      assert(s.url && s.url.indexOf("http") === 0, "stream has http(s) url");
      assert.strictEqual(s.provider, "multimovies");
      assert.strictEqual(s.type, "m3u8");
      assert(s.headers && s.headers["User-Agent"], "stream carries UA header");
    });
    // Streams must be sorted by quality (1080p ≥ 720p ≥ Auto)
    const qOrder = { "4K": 6, "1440p": 5, "1080p": 4, "720p": 3, "480p": 2, "360p": 1, "Auto": 0 };
    for (let i = 1; i < streams.length; i++) {
      assert((qOrder[streams[i - 1].quality] || 0) >= (qOrder[streams[i].quality] || 0),
        "streams not quality-sorted");
    }
  });
});

test("multimovies getStreams returns [] when watchConfig is absent", () => {
  return withFetch(async (url) => {
    url = String(url);
    if (url.indexOf("api.themoviedb.org") !== -1) {
      return mockRes({ ok: true, json: { id: 1234139, title: "Jailer 2", original_title: "Jailer 2", release_date: "2026-07-01", external_ids: {}, alternative_titles: { titles: [] } } });
    }
    if (url.indexOf("multimovies.wtf") !== -1) {
      return mockRes({ ok: true, body: `<a class="cta-primary" href="https://m1.multimovies.courses">x</a>` });
    }
    if (url.indexOf("/search") !== -1) {
      return mockRes({ ok: true, body: `<a href="/movie/jailer-2">Jailer 2</a>` });
    }
    if (url.indexOf("/movie/jailer-2") !== -1) {
      return mockRes({ ok: true, body: "<html><body>no watchConfig here</body></html>" });
    }
    return mockRes({ ok: false, status: 404 });
  }, async () => {
    const streams = await mmProvider.getStreams(1234139, "movie");
    assert.deepStrictEqual(streams, []);
  });
});

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
