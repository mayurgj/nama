// Stream formatter: how each stream card reads in Nuvio.
//
// Nuvio (KMP app) shows `name` in bold and grey text built from
// `quality • size • language`; `title` is only used when `name` is missing.
// Quality goes in the name, so only `size` feeds the grey lines.
//
// NAMA | AnimeSalt | 1080p
// Naruto S01E001 • Enter: Naruto Uzumaki!
// HLS • ravok.buzz
// 🎧 HI • TA • TE • EN • JA
//
// `title` keeps the full multi-line layout for Nuvio builds that display it.

var NAMA_LANGS = {
  hin: "HI", hi: "HI", hindi: "HI",
  tam: "TA", ta: "TA", tamil: "TA",
  tel: "TE", te: "TE", telugu: "TE",
  mal: "ML", ml: "ML", malayalam: "ML",
  ben: "BN", bn: "BN", bengali: "BN", bangla: "BN",
  kan: "KN", kn: "KN", kannada: "KN",
  mar: "MR", mr: "MR", marathi: "MR",
  eng: "EN", en: "EN", english: "EN",
  jpn: "JA", ja: "JA", jap: "JA", japanese: "JA",
  kor: "KO", ko: "KO", korean: "KO",
  zho: "ZH", chi: "ZH", zh: "ZH", chinese: "ZH",
};
var NAMA_LANG_ORDER = ["HI", "TA", "TE", "ML", "BN", "KN", "MR", "EN", "JA", "KO", "ZH"];

function namaLangCode(audio) {
  var keys = [audio.lang, audio.name];
  for (var i = 0; i < keys.length; i++) {
    var k = String(keys[i] || "").toLowerCase().trim();
    if (NAMA_LANGS[k]) return NAMA_LANGS[k];
  }
  if (/^[a-z]{2}$/i.test(audio.lang || "")) return audio.lang.toUpperCase();
  return String(audio.name || audio.lang || "??").slice(0, 2).toUpperCase();
}

function namaLangs(audios) {
  var codes = [];
  audios.forEach(function (a) {
    var c = namaLangCode(a);
    if (codes.indexOf(c) < 0) codes.push(c);
  });
  return codes.sort(function (a, b) {
    var ia = NAMA_LANG_ORDER.indexOf(a);
    var ib = NAMA_LANG_ORDER.indexOf(b);
    return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
  });
}

function namaPad(n, w) {
  var s = String(n);
  while (s.length < w) s = "0" + s;
  return s;
}

function namaHeading(meta) {
  if (meta.type === "movie") return meta.title + (meta.year ? " (" + meta.year + ")" : "");
  var ep = "S" + namaPad(meta.season, 2) + "E" + namaPad(meta.episode, 3);
  return meta.title + " " + ep + " • " + (meta.episodeName || "Episode " + namaPad(meta.episode, 3));
}

// heights: resolutions this stream carries (one for per-resolution streams).
function namaFormatStream(ctx, url, heights) {
  var langs = namaLangs(ctx.audios);
  var audioLine = langs.length > 1 ? "🎧 Multi-Audio: " + langs.join(" • ") : "🎧 " + (langs[0] || "Unknown");
  var res = heights
    .filter(function (h) {
      return h > 0;
    })
    .map(function (h) {
      return h + "p";
    });
  var quality = res[0] || "Auto";
  var heading = namaHeading(ctx.meta);
  // Per-language streams carry one audio track: tag the name, spell out the language.
  var single = ctx.audios.length === 1 && ctx.perLanguage;
  if (single) audioLine = "🎧 " + (ctx.audios[0].name || langs[0]);
  var label = ctx.site.name + (ctx.server ? " · " + ctx.server : "");
  return {
    name: "NAMA | " + label + " | " + quality + (single ? " | " + langs[0] : "") + "\n" + heading,
    title: [heading, audioLine, "📺 " + (res.length ? res.join(" • ") : "Auto") + " • HLS", "🌐 " + ctx.host].join("\n"),
    url: url,
    size: "HLS • " + ctx.host + "\n" + (langs.length > 1 ? "🎧 " + langs.join(" • ") : audioLine),
    provider: ctx.site.name,
    type: "hls",
    headers: ctx.headers,
    behaviorHints: { notWebReady: true },
    _langCount: langs.length,
    _langRank: single ? NAMA_LANG_ORDER.indexOf(langs[0]) >>> 0 : -1,
    _height: heights[0] || 0,
  };
}

// 1080p first, then 720p; within a resolution multi-audio first (more languages
// first), then per-language streams in NAMA_LANG_ORDER.
function namaSortStreams(streams) {
  return streams
    .sort(function (a, b) {
      return b._height - a._height || b._langCount - a._langCount || a._langRank - b._langRank;
    })
    .map(function (s) {
      delete s._langCount;
      delete s._langRank;
      delete s._height;
      return s;
    });
}
