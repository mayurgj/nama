const assert = require("assert");
const {
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
} = require("../src/shared/formatter");

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    passed++;
    console.log(`  \u2713 ${name}`);
  } catch (err) {
    failed++;
    console.error(`  \u2717 ${name}\n    ${err && err.stack || err}`);
  }
}

function section(label) { console.log(`\n[${label}]`); }

console.log("=== formatter unit tests ===");

// ─── parseResolution ──────────────────────────────────────────────────────
section("parseResolution");
[
  ["Jailer.2.2026.1080p.WEB-DL", null, "1080p"],
  ["Movie.2160p.HEVC.mkv",       null, "2160p"],
  ["Something.4K.UHD.HDR",       null, "2160p"],
  ["Show.2K.QHD",                null, "1440p"],
  ["Show.1440p",                 null, "1440p"],
  ["Film.720p.WEB-DL",           null, "720p"],
  ["Film.480p.HDRip",            null, "480p"],
  ["No marker here",             null, null],
  ["",                           null, null],
  [null,                         null, null],
  ["",                           1080, "1080p"],
  ["",                           720,  "720p"],
  ["",                           2160, "2160p"],
  ["ignored by hint",            480,  "480p"]
].forEach(([text, h, expected]) => {
  test(`parseResolution(${JSON.stringify(text)}, ${h}) → ${expected}`, () => {
    assert.strictEqual(parseResolution(text, h), expected);
  });
});

// ─── parseQuality ─────────────────────────────────────────────────────────
section("parseQuality");
[
  ["Movie.2026.BluRay.Remux.2160p",         "BluRay Remux"],
  ["Movie.2026.Remux.2160p",                "BluRay Remux"],
  ["Movie.2026.BluRay.1080p",               "BluRay"],
  ["Movie.2026.BDRip.1080p",                "BluRay"],
  ["Movie.2026.WEB-DL.1080p",               "WEB-DL"],
  ["Movie.2026.WEBDL.1080p",                "WEB-DL"],
  ["Movie.2026.WEBRip.1080p",               "WEBRip"],
  ["Movie.2026.WEB.1080p",                  "WEB-DL"],
  ["Movie.2026.HC.HDRip.720p",              "HC HDRip"],
  ["Movie.2026.HDRip.720p",                 "HDRip"],
  ["Movie.1998.DVDRip",                     "DVDRip"],
  ["Movie.HDTV.720p",                       "HDTV"],
  ["Movie.CAMRip.2026",                     "CAMRip"],
  ["Movie.2026.CAM",                        "CAM"],
  ["Movie.TS.2026",                         "TS"],
  ["No quality marker",                      null],
  ["",                                       null],
  [null,                                     null]
].forEach(([text, expected]) => {
  test(`parseQuality(${JSON.stringify(text)}) → ${expected}`, () => {
    assert.strictEqual(parseQuality(text), expected);
  });
});

// ─── parseEncode ──────────────────────────────────────────────────────────
section("parseEncode");
[
  ["Movie.1080p.x265",     "x265"],
  ["Movie.1080p.HEVC",     "x265"],
  ["Movie.1080p.H.265",    "x265"],
  ["Movie.1080p.H265",     "x265"],
  ["Movie.1080p.x264",     "x264"],
  ["Movie.1080p.H.264",    "x264"],
  ["Movie.1080p.AVC",      "x264"],
  ["Movie.1080p.AV1",      "AV1"],
  ["Movie.1080p.VP9",      "VP9"],
  ["No codec marker",       null],
  ["",                      null]
].forEach(([text, expected]) => {
  test(`parseEncode(${JSON.stringify(text)}) → ${expected}`, () => {
    assert.strictEqual(parseEncode(text), expected);
  });
});

// ─── parseVisualTags ──────────────────────────────────────────────────────
section("parseVisualTags");
[
  ["Movie.2160p.DV.HDR10+",       ["DV", "HDR10+"]],
  ["Movie.2160p.Dolby.Vision",     ["DV"]],
  ["Movie.2160p.DoVi",             ["DV"]],
  ["Movie.2160p.HDR10+",           ["HDR10+"]],
  ["Movie.2160p.HDR10",            ["HDR10"]],
  ["Movie.2160p.HDR",              ["HDR"]],
  ["Movie.1080p.HLG",              ["HLG"]],
  ["Movie.2160p.DV.HDR10",         ["DV", "HDR10"]],
  ["Movie.1080p",                  []],
  ["",                             []]
].forEach(([text, expected]) => {
  test(`parseVisualTags(${JSON.stringify(text)}) → [${expected.join(",")}]`, () => {
    assert.deepStrictEqual(parseVisualTags(text), expected);
  });
});

// ─── parseAudioTags ───────────────────────────────────────────────────────
section("parseAudioTags");
[
  ["Movie.TrueHD.Atmos.7.1",       ["Atmos", "TrueHD"]],
  ["Movie.DTS-HD.MA.5.1",          ["DTS-HD MA"]],
  ["Movie.DTS-HD.5.1",             ["DTS-HD"]],
  ["Movie.DTS-X.7.1",              ["DTS-X"]],
  ["Movie.DTS.5.1",                ["DTS"]],
  ["Movie.DDP5.1",                 ["DD+"]],
  ["Movie.EAC3.5.1",               ["DD+"]],
  ["Movie.DD+.5.1",                ["DD+"]],
  ["Movie.AC3.5.1",                ["DD"]],
  ["Movie.DD.5.1",                 ["DD"]],
  ["Movie.AAC",                    ["AAC"]],
  ["Movie.FLAC",                   ["FLAC"]],
  ["Movie.Opus",                   ["Opus"]],
  ["No audio marker",              []],
  ["",                             []]
].forEach(([text, expected]) => {
  test(`parseAudioTags(${JSON.stringify(text)}) → [${expected.join(",")}]`, () => {
    assert.deepStrictEqual(parseAudioTags(text), expected);
  });
});

// ─── parseAudioChannels ───────────────────────────────────────────────────
section("parseAudioChannels");
[
  ["Movie.DDP5.1",      ["5.1"]],
  ["Movie.TrueHD.7.1",  ["7.1"]],
  ["Movie.AAC.2.0",     ["2.0"]],
  ["Movie.AAC.Stereo",  ["2.0"]],
  ["Movie.5.1.and.7.1", ["5.1", "7.1"]],
  ["No channel info",    []],
  ["",                   []]
].forEach(([text, expected]) => {
  test(`parseAudioChannels(${JSON.stringify(text)}) → [${expected.join(",")}]`, () => {
    assert.deepStrictEqual(parseAudioChannels(text), expected);
  });
});

// ─── parseLanguages ───────────────────────────────────────────────────────
section("parseLanguages");
[
  ["Movie.Hindi.Dubbed",                 ["dub", "hi"]],
  ["Movie.Tamil-Telugu-Hindi",           ["hi", "ta", "te"]],
  ["Movie.English",                      ["en"]],
  ["Movie.Multi.Audio",                  ["multi"]],
  ["Movie.Dual.Audio.Hindi-English",     ["dual", "en", "hi"]],
  ["Movie.Japanese",                     ["ja"]],
  ["Movie.Korean",                       ["ko"]],
  ["Movie.1080p",                        []],
  ["",                                   []]
].forEach(([text, expected]) => {
  test(`parseLanguages(${JSON.stringify(text)}) → [${expected.join(",")}]`, () => {
    const actual = parseLanguages(text).sort();
    assert.deepStrictEqual(actual, [...expected].sort());
  });
});

// ─── parseReleaseGroup ────────────────────────────────────────────────────
section("parseReleaseGroup");
[
  ["Movie.2026.1080p.WEB-DL-RARBG",            "RARBG"],
  ["Movie.2026.1080p.BluRay.x265-YIFY.mkv",    "YIFY"],
  ["Movie.2026.1080p.WEB-DL-GROUP.mp4",        "GROUP"],
  ["[SubsPlease] Naruto - 220 [1080p]",         "SubsPlease"],
  ["No group marker",                           null],
  ["",                                          null]
].forEach(([text, expected]) => {
  test(`parseReleaseGroup(${JSON.stringify(text)}) → ${expected}`, () => {
    assert.strictEqual(parseReleaseGroup(text), expected);
  });
});

// ─── parseSize ────────────────────────────────────────────────────────────
section("parseSize");
test("parseSize passes through numbers", () => {
  assert.strictEqual(parseSize(1024), 1024);
  assert.strictEqual(parseSize(0), 0);
});
test("parseSize handles 'B/KB/MB/GB/TB'", () => {
  assert.strictEqual(parseSize("1 B"), 1);
  assert.strictEqual(parseSize("1 KB"), 1024);
  assert.strictEqual(parseSize("1.5 MB"), Math.round(1.5 * 1024 ** 2));
  assert.strictEqual(parseSize("2 GB"), 2 * 1024 ** 3);
  assert.strictEqual(parseSize("1 TB"), 1024 ** 4);
});
test("parseSize returns null for garbage", () => {
  assert.strictEqual(parseSize(null), null);
  assert.strictEqual(parseSize(undefined), null);
  assert.strictEqual(parseSize("not a size"), null);
  assert.strictEqual(parseSize(-5), null);
});

// ─── detectType ───────────────────────────────────────────────────────────
section("detectType");
[
  ["https://cdn/example/master.m3u8?token=t", "m3u8"],
  ["https://cdn/example/video.mp4",            "mp4"],
  ["https://cdn/example/video.mkv",            "mkv"],
  ["https://cdn/example/manifest.mpd",         "mpd"],
  ["https://cdn/example/hls/stream",           "m3u8"],
  ["https://cdn/example/stream/path",          "mp4"],
  ["https://cdn/example/no-extension",          null],
  [null,                                        null],
  ["",                                          null]
].forEach(([url, expected]) => {
  test(`detectType(${JSON.stringify(url)}) → ${expected}`, () => {
    assert.strictEqual(detectType(url), expected);
  });
});

// ─── normalizeSeasonEpisode ───────────────────────────────────────────────
section("normalizeSeasonEpisode");
test("object form zero-pads", () => {
  assert.deepStrictEqual(normalizeSeasonEpisode({ season: 1, episode: 5 }), ["S01", "E05"]);
  assert.deepStrictEqual(normalizeSeasonEpisode({ season: 12, episode: 100 }), ["S12", "E100"]);
});
test("array form passes through", () => {
  assert.deepStrictEqual(normalizeSeasonEpisode(["S01", "E05"]), ["S01", "E05"]);
});
test("invalid input returns null", () => {
  assert.strictEqual(normalizeSeasonEpisode(null), null);
  assert.strictEqual(normalizeSeasonEpisode("foo"), null);
  assert.strictEqual(normalizeSeasonEpisode({}), null);
  assert.strictEqual(normalizeSeasonEpisode({ season: "x", episode: "y" }), null);
});

// ─── formatStream (integration) ───────────────────────────────────────────
section("formatStream");
test("requires url and provider", () => {
  assert.throws(() => formatStream({}));
  assert.throws(() => formatStream({ url: "x" }));
  assert.throws(() => formatStream({ provider: "x" }));
});

test("end-to-end parse of a realistic release title", () => {
  const s = formatStream({
    url: "https://cdn.example/hls/abc/master.m3u8?token=t",
    provider: "multimovies",
    title: "Jailer.2.2026.1080p.WEB-DL.DDP5.1.H.265.Hindi-Tamil-Telugu-RARBG.mkv"
  });
  assert.strictEqual(s.url, "https://cdn.example/hls/abc/master.m3u8?token=t");
  assert.strictEqual(s.provider, "multimovies");
  assert.strictEqual(s.type, "m3u8");
  assert.strictEqual(s.resolution, "1080p");
  assert.strictEqual(s.quality, "WEB-DL");
  assert.strictEqual(s.encode, "x265");
  assert.deepStrictEqual(s.audioTags, ["DD+"]);
  assert.deepStrictEqual(s.audioChannels, ["5.1"]);
  assert.deepStrictEqual(s.languages.sort(), ["hi", "ta", "te"]);
  assert.strictEqual(s.releaseGroup, "RARBG");
  assert.deepStrictEqual(s.visualTags, []);
  assert.deepStrictEqual(s.subtitles, []);
});

test("explicit args override parsers", () => {
  const s = formatStream({
    url: "https://x/master.m3u8",
    provider: "test",
    title: "Foo.2160p.HDR10",
    resolution: "1080p",
    visualTags: ["DV"],
    languages: ["ja"]
  });
  assert.strictEqual(s.resolution, "1080p");
  assert.deepStrictEqual(s.visualTags, ["DV"]);
  assert.deepStrictEqual(s.languages, ["ja"]);
});

test("height hint feeds parseResolution when title lacks resolution", () => {
  const s = formatStream({
    url: "https://x/720/index.m3u8",
    provider: "test",
    height: 720
  });
  assert.strictEqual(s.resolution, "720p");
});

test("missing title → null-ish structured fields", () => {
  const s = formatStream({
    url: "https://x/stream.mp4",
    provider: "test"
  });
  assert.strictEqual(s.resolution, null);
  assert.strictEqual(s.quality, null);
  assert.strictEqual(s.encode, null);
  assert.deepStrictEqual(s.visualTags, []);
  assert.deepStrictEqual(s.audioTags, []);
  assert.deepStrictEqual(s.audioChannels, []);
  assert.deepStrictEqual(s.languages, []);
  assert.strictEqual(s.releaseGroup, null);
  assert.strictEqual(s.type, "mp4");
});

test("seasonEpisode is normalized on output", () => {
  const s = formatStream({
    url: "https://x/s01e05.m3u8",
    provider: "test",
    seasonEpisode: { season: 1, episode: 5 }
  });
  assert.deepStrictEqual(s.seasonEpisode, ["S01", "E05"]);
});

test("no legacy name field on output", () => {
  const s = formatStream({ url: "https://x/stream.m3u8", provider: "test" });
  assert.strictEqual(s.name, undefined);
});

console.log(`\n=== formatter: ${passed} passed, ${failed} failed ===`);
if (failed > 0) process.exit(1);
