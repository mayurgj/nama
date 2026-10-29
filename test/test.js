const assert = require("assert");
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const MANIFEST_PATH = path.join(ROOT, "manifest.json");
const ANIMESALT_BUNDLE = path.join(ROOT, "providers", "animesalt.js");
const MULTIMOVIES_BUNDLE = path.join(ROOT, "providers", "multimovies.js");

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

// ---------- 2. Shared utilities ----------
section("shared/constants");
const {
  cleanTitle,
  titleSimilarity,
  unpack,
  isRealStreamUrl,
  joinUrl,
  validateEpisodeInput,
  heightToQuality,
  parseHlsMaster,
  hlsAudioTrackCount,
  RESOLUTION_ORDER
} = require("../src/shared/constants");

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

test("heightToQuality maps pixel heights to canonical labels", () => {
  assert.strictEqual(heightToQuality(2160), "2160p");
  assert.strictEqual(heightToQuality(1440), "1440p");
  assert.strictEqual(heightToQuality(1080), "1080p");
  assert.strictEqual(heightToQuality(720), "720p");
  assert.strictEqual(heightToQuality(480), "480p");
  assert.strictEqual(heightToQuality(240), "240p");
  assert.strictEqual(heightToQuality(0), null);
  assert.strictEqual(heightToQuality(NaN), null);
});

test("parseHlsMaster extracts variants with resolution label", () => {
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
  assert.strictEqual(variants[0].resolution, "1080p");
  assert.strictEqual(variants[0].height, 1080);
  assert.ok(variants[0].url.endsWith("1080/index.m3u8?md5=TOKEN&expires=99"));
  assert.strictEqual(variants[1].resolution, "720p");
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

test("RESOLUTION_ORDER sorts descending", () => {
  assert(RESOLUTION_ORDER["2160p"] > RESOLUTION_ORDER["1080p"]);
  assert(RESOLUTION_ORDER["1080p"] > RESOLUTION_ORDER["720p"]);
  assert(RESOLUTION_ORDER["720p"] > RESOLUTION_ORDER["480p"]);
});

// ---------- 3. Exports ----------
section("exports");
const animesaltProvider = require("../src/providers/animesalt");
test("src/providers/animesalt exports getStreams", () => {
  assert.strictEqual(typeof animesaltProvider.getStreams, "function");
});
const multimoviesProvider = require("../src/providers/multimovies");
test("src/providers/multimovies exports getStreams", () => {
  assert.strictEqual(typeof multimoviesProvider.getStreams, "function");
});

if (fs.existsSync(ANIMESALT_BUNDLE)) {
  delete require.cache[require.resolve(ANIMESALT_BUNDLE)];
  const bundle = require(ANIMESALT_BUNDLE);
  test("animesalt bundle exports getStreams", () => {
    assert.strictEqual(typeof bundle.getStreams, "function");
  });
} else {
  skip("animesalt bundle exports getStreams", "run `node build.js`");
}

if (fs.existsSync(MULTIMOVIES_BUNDLE)) {
  delete require.cache[require.resolve(MULTIMOVIES_BUNDLE)];
  const bundle = require(MULTIMOVIES_BUNDLE);
  test("multimovies bundle exports getStreams", () => {
    assert.strictEqual(typeof bundle.getStreams, "function");
  });
} else {
  skip("multimovies bundle exports getStreams", "run `node build.js`");
}

// ---------- 4. Extractor negative paths (mocked fetch) ----------
section("animesalt extractors (mocked)");
const { extractStreamWish } = require("../src/providers/animesalt/extractors/streamwish");
const { extractMegaPlay } = require("../src/providers/animesalt/extractors/megaplay");
const { extractAwsStream } = require("../src/providers/animesalt/extractors/awsstream");

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

// ---------- 5. MultiMovies end-to-end (mocked fetch) ----------
section("multimovies (mocked)");

test("multimovies getStreams rejects missing tmdbId", async () => {
  assert.deepStrictEqual(await multimoviesProvider.getStreams(null, "movie"), []);
  assert.deepStrictEqual(await multimoviesProvider.getStreams(undefined, "movie"), []);
});

test("multimovies getStreams rejects invalid tv season/episode", async () => {
  assert.deepStrictEqual(await multimoviesProvider.getStreams(1234139, "tv", 0, 1), []);
  assert.deepStrictEqual(await multimoviesProvider.getStreams(1234139, "tv", 1, 0), []);
  assert.deepStrictEqual(await multimoviesProvider.getStreams(1234139, "tv", "a", "b"), []);
});

test("multimovies getStreams returns [] when TMDB lookup fails", () =>
  withFetch(() => mockRes({ ok: false, status: 500 }), async () => {
    const r = await multimoviesProvider.getStreams(1234139, "movie");
    assert.deepStrictEqual(r, []);
  }));

test("multimovies end-to-end movie flow with mocked network", () => {
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
      {"id":"a3","name":"VIDOUT","type":"iframe","url":"https://vidout.pages.dev/movie/tt33318732"},
      {"id":"a4","name":"VidBolt","type":"iframe","url":"https://vidbolt.xyz/movie/1234139"},
      {"id":"a5","name":"Filmu","type":"iframe","url":"https://embed.filmu.in/movie/1234139"}
    ]};</script></body></html>`;
  const vidlyHtml = `<html><body>
    <link rel="preload" href="https://proxy.streamrip.fun/m/ABCTOKEN?f=.m3u8" as="fetch">
  </body></html>`;

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
    if (url.indexOf("vidbolt.xyz/api/resolve") !== -1) {
      return mockRes({ ok: true, json: {
        stream: {
          server: "vega",
          sources: [
            { url: "https://proxy.vidbolt.xyz/m/aaaa?f=.m3u8", kind: "hls", quality: "1080p", language: "Tamil" },
            { url: "https://proxy.vidbolt.xyz/m/bbbb?f=.m3u8", kind: "hls", quality: "720p", language: "Hindi" }
          ]
        }
      } });
    }
    if (url.indexOf("embed.filmu.in") !== -1 || url.indexOf("vidly.pro") !== -1) {
      return mockRes({ ok: true, body: vidlyHtml });
    }
    return mockRes({ ok: false, status: 404 });
  }, async () => {
    const streams = await multimoviesProvider.getStreams(1234139, "movie");
    assert(Array.isArray(streams) && streams.length >= 5, "expected >=5 streams, got " + streams.length);

    // Structured-shape invariants: every stream has the schema fields,
    // nothing has the legacy `name` key.
    streams.forEach((s) => {
      assert(s.url && s.url.indexOf("http") === 0, "stream has http(s) url");
      assert.strictEqual(s.provider, "multimovies");
      assert.strictEqual(s.type, "m3u8");
      assert.strictEqual(s.name, undefined, "legacy name field must be absent");
      assert(Array.isArray(s.visualTags), "visualTags array");
      assert(Array.isArray(s.audioTags), "audioTags array");
      assert(Array.isArray(s.audioChannels), "audioChannels array");
      assert(Array.isArray(s.languages), "languages array");
      assert(Array.isArray(s.subtitles), "subtitles array");
      assert(s.headers && s.headers["User-Agent"], "stream carries UA header");
    });

    // Specific extractor outputs are present and parsed correctly.
    const vidrift = streams.filter((s) => /vidrift/i.test(s.url) || /hls\/(?:abc|hin)/.test(s.url));
    assert(vidrift.length >= 2, "has >=2 Vidrift streams");

    const vidbolt = streams.filter((s) => /proxy\.vidbolt/.test(s.url));
    assert.strictEqual(vidbolt.length, 2, "has 2 VidBolt streams");
    const vidboltResolutions = vidbolt.map((s) => s.resolution).sort();
    assert.deepStrictEqual(vidboltResolutions, ["1080p", "720p"]);
    const vidboltLanguages = new Set();
    vidbolt.forEach((s) => s.languages.forEach((l) => vidboltLanguages.add(l)));
    assert(vidboltLanguages.has("ta"), "VidBolt Tamil mapped to 'ta'");
    assert(vidboltLanguages.has("hi"), "VidBolt Hindi mapped to 'hi'");

    const vidout = streams.find((s) => /vidout\/jailer2/.test(s.url));
    assert(vidout, "has VIDOUT stream");
    assert.strictEqual(vidout.resolution, "720p");
    assert.deepStrictEqual(vidout.languages, ["multi"]);

    const cineverse = streams.find((s) => /XYZCODE1/.test(s.url));
    assert(cineverse, "has Cineverse stream");
    assert.strictEqual(cineverse.resolution, "1080p");
    assert.strictEqual(cineverse.encode, "x265");
    assert(cineverse.languages.includes("hi") && cineverse.languages.includes("ta"),
      "Cineverse parsed Hindi+Tamil from vidara title");

    const filmu = streams.find((s) => /streamrip\.fun/.test(s.url));
    assert(filmu, "has Filmu stream");

    // Sort order: resolution descending via RESOLUTION_ORDER
    for (let i = 1; i < streams.length; i++) {
      const prev = RESOLUTION_ORDER[streams[i - 1].resolution];
      const curr = RESOLUTION_ORDER[streams[i].resolution];
      const prevVal = prev != null ? prev : -1;
      const currVal = curr != null ? curr : -1;
      assert(prevVal >= currVal, "streams not resolution-sorted");
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
    const streams = await multimoviesProvider.getStreams(1234139, "movie");
    assert.deepStrictEqual(streams, []);
  });
});

// ---------- 6. getStreams input validation (animesalt) ----------
section("animesalt getStreams validation");
test("animesalt getStreams rejects missing tmdbId", async () => {
  assert.deepStrictEqual(await animesaltProvider.getStreams(null, "movie"), []);
  assert.deepStrictEqual(await animesaltProvider.getStreams(undefined, "movie"), []);
});

test("animesalt getStreams rejects invalid season/episode for tv", async () => {
  assert.deepStrictEqual(await animesaltProvider.getStreams(1, "tv", 0, 1), []);
  assert.deepStrictEqual(await animesaltProvider.getStreams(1, "tv", 1, 0), []);
  assert.deepStrictEqual(await animesaltProvider.getStreams(1, "tv", "a", "b"), []);
});

// ---------- 7. Network-backed tests (optional) ----------
section("network (optional, --network to enable)");
const runNetwork = process.argv.includes("--network") || process.env.NUVIO_RUN_NETWORK === "1";

async function runNetworkSuite() {
  const { fetchTmdbDetails } = require("../src/shared/tmdb");
  test("TMDB tv fetch", async () => {
    const tv = await fetchTmdbDetails(85937, "tv");
    assert(tv && tv.title && tv.title.length > 0, "expected tv title");
  });
  test("TMDB movie fetch", async () => {
    const mv = await fetchTmdbDetails(372058, "movie");
    assert(mv && mv.title && mv.title.length > 0, "expected movie title");
  });
  test("animesalt getStreams returns array end-to-end", async () => {
    const streams = await animesaltProvider.getStreams(85937, "tv", 1, 1);
    assert(Array.isArray(streams), "must return array");
  });
}

if (runNetwork) {
  runNetworkSuite();
} else {
  skip("TMDB tv fetch", "pass --network or NUVIO_RUN_NETWORK=1");
  skip("TMDB movie fetch", "pass --network or NUVIO_RUN_NETWORK=1");
  skip("animesalt getStreams returns array end-to-end", "pass --network or NUVIO_RUN_NETWORK=1");
}

runQueue().then(() => {
  console.log(`\n=== ${passed} passed, ${failed} failed, ${skipped} skipped ===`);
  if (failed > 0) process.exit(1);
});
