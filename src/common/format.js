// Stream formatter: how each stream card reads in Nuvio.
//
// Nuvio shows `name` in bold and grey text built from `quality • size • language`;
// `title` is only used when `name` is missing. Everything grey goes in `size`.
//
// 1080p | Multi Audio                 (single language: "1080p | Hindi")
// 🎧 HIN • TAM • TEL • ENG • JPN      (multi-audio only)
// 📺 HLS • AVC • AAC 2.0
// 🌐 AnimeSalt | ravok.buzz
//
// The wording is chosen so Nuvio badge packs (regexes over name + description) can match:
// "1080p", "Multi Audio", full language names, ISO 639-2 codes (hin, eng, jpn), codecs, channels.

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
  spa: "ES", es: "ES", spanish: "ES",
  fra: "FR", fre: "FR", fr: "FR", french: "FR",
  deu: "DE", ger: "DE", de: "DE", german: "DE",
  ita: "IT", it: "IT", italian: "IT",
  por: "PT", pt: "PT", portuguese: "PT",
  rus: "RU", ru: "RU", russian: "RU",
  ara: "AR", ar: "AR", arabic: "AR",
  ind: "ID", id: "ID", indonesian: "ID",
  tha: "TH", th: "TH", thai: "TH",
  vie: "VI", vi: "VI", vietnamese: "VI",
};
// Language preference, used for sorting and for the audio line.
var NAMA_LANG_ORDER = ["HI", "TA", "TE", "ML", "BN", "KN", "MR", "EN", "JA", "KO", "ZH"];
// Display forms: ISO 639-2 short codes and full names (both are what badge packs look for).
var NAMA_LANG_INFO = {
  HI: ["HIN", "Hindi"], TA: ["TAM", "Tamil"], TE: ["TEL", "Telugu"], ML: ["MAL", "Malayalam"],
  BN: ["BEN", "Bengali"], KN: ["KAN", "Kannada"], MR: ["MAR", "Marathi"], EN: ["ENG", "English"],
  JA: ["JPN", "Japanese"], KO: ["KOR", "Korean"], ZH: ["CHI", "Chinese"],
  ES: ["SPA", "Spanish"], FR: ["FRE", "French"], DE: ["GER", "German"], IT: ["ITA", "Italian"],
  PT: ["POR", "Portuguese"], RU: ["RUS", "Russian"], AR: ["ARA", "Arabic"], ID: ["IND", "Indonesian"],
  TH: ["THA", "Thai"], VI: ["VIE", "Vietnamese"],
};

// Stream sort keys, most important first; reorder (or drop) to taste and rebuild.
//   "resolution": 1080p before 720p
//   "multi":      more audio languages first (multi-audio before single-language)
//   "language":   streams with a language earlier in NAMA_LANG_ORDER first (Hindi, then Tamil, ...)
var NAMA_SORT = ["resolution", "multi", "language"];

function namaLangCode(audio) {
  // Names can be numbered ("8. Hindi") or carry extras ("Hindi (Original)").
  var name = String(audio.name || "").replace(/^\s*\d+[.)]?\s*/, "").trim();
  var keys = [audio.lang, name, name.split(/[\s(\[-]/)[0]];
  for (var i = 0; i < keys.length; i++) {
    var k = String(keys[i] || "").toLowerCase().trim();
    if (NAMA_LANGS[k]) return NAMA_LANGS[k];
  }
  // Unmapped ISO code ("pol", "ukr") is shown as-is; otherwise the name's first letters.
  if (/^[a-z]{2,3}$/i.test(audio.lang || "") && !/^(und|mul|unk)$/i.test(audio.lang)) return audio.lang.toUpperCase();
  var letters = name.replace(/[^a-z]/gi, "");
  return letters ? letters.slice(0, 3).toUpperCase() : "UND";
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

function namaLangShort(code) {
  return (NAMA_LANG_INFO[code] || [code])[0];
}

function namaLangFull(code, audio) {
  if (NAMA_LANG_INFO[code]) return NAMA_LANG_INFO[code][1];
  return (audio && audio.name) || code;
}

var NAMA_VIDEO_CODECS = [[/^avc/, "AVC"], [/^(hvc|hev)/, "HEVC"], [/^av01/, "AV1"], [/^vp0?9/, "VP9"]];
var NAMA_AUDIO_CODECS = [[/^mp4a\.40\.(2|5|29)$/, "AAC"], [/^mp4a/, "AAC"], [/^ac-3/, "DD"], [/^ec-3/, "DD+"], [/^opus/, "OPUS"], [/^flac/, "FLAC"]];
var NAMA_CHANNELS = { 1: "1.0", 2: "2.0", 6: "5.1", 8: "7.1" };

function namaCodec(list, codecs) {
  for (var i = 0; i < codecs.length; i++) {
    for (var j = 0; j < list.length; j++) {
      if (list[j][0].test(codecs[i])) return list[j][1];
    }
  }
  return "";
}

// Technical line from the variant's #EXT-X-STREAM-INF and the audio renditions: "HLS • AVC • AAC 2.0".
function namaTech(inf, audios, format) {
  var codecs = String((/CODECS="([^"]*)"/.exec(inf || "") || [])[1] || "")
    .toLowerCase()
    .split(",")
    .map(function (c) {
      return c.trim();
    });
  var video = namaCodec(NAMA_VIDEO_CODECS, codecs);
  var audio = namaCodec(NAMA_AUDIO_CODECS, codecs);
  var ch = "";
  for (var i = 0; i < audios.length && !ch; i++) {
    var n = (/CHANNELS="(\d+)/.exec(audios[i].line || "") || [])[1];
    if (n) ch = NAMA_CHANNELS[n] || n + "ch";
  }
  var parts = [format || "HLS"];
  if (video) parts.push(video);
  if (audio || ch) parts.push([audio, ch].filter(Boolean).join(" "));
  return parts.join(" • ");
}

// heights: resolutions this stream carries (one for per-resolution streams).
// inf: the #EXT-X-STREAM-INF line of the video variant, for codecs (optional).
function namaFormatStream(ctx, url, heights, inf) {
  var langs = namaLangs(ctx.audios);
  var res = heights.filter(function (h) {
    return h > 0;
  });
  var quality = res.length ? res[0] + "p" : "Auto";
  var multi = langs.length > 1;
  var langLabel = multi ? "Multi Audio" : langs.length ? namaLangFull(langs[0], ctx.audios[0]) : "Unknown";
  var name = quality + " | " + langLabel;
  var lines = [];
  if (multi) lines.push("🎧 " + langs.map(namaLangShort).join(" • "));
  lines.push("📺 " + namaTech(inf, ctx.audios, ctx.format));
  lines.push("🌐 " + ctx.site.name + " | " + (ctx.server || ctx.host));
  var size = lines.join("\n");
  return {
    name: name,
    title: name + "\n" + size,
    url: url,
    size: size,
    provider: ctx.site.name,
    type: ctx.format === "MP4" ? "mp4" : "hls",
    headers: ctx.headers,
    behaviorHints: { notWebReady: true },
    _langCount: langs.length,
    _langs: langs,
    _height: heights[0] || 0,
  };
}

// The first language in NAMA_LANG_ORDER that one stream has and the other lacks decides.
function namaCompareLangs(a, b) {
  for (var i = 0; i < NAMA_LANG_ORDER.length; i++) {
    var ha = a.indexOf(NAMA_LANG_ORDER[i]) >= 0;
    var hb = b.indexOf(NAMA_LANG_ORDER[i]) >= 0;
    if (ha !== hb) return ha ? -1 : 1;
  }
  return 0;
}

var NAMA_SORT_KEYS = {
  resolution: function (a, b) {
    return b._height - a._height;
  },
  multi: function (a, b) {
    return b._langCount - a._langCount;
  },
  language: function (a, b) {
    return namaCompareLangs(a._langs, b._langs);
  },
};

// Sorts by NAMA_SORT; ties keep provider order.
function namaSortStreams(streams) {
  var keys = NAMA_SORT.map(function (k) {
    return NAMA_SORT_KEYS[k];
  }).filter(Boolean);
  return streams
    .map(function (s, i) {
      s._index = i;
      return s;
    })
    .sort(function (a, b) {
      for (var i = 0; i < keys.length; i++) {
        var d = keys[i](a, b);
        if (d) return d;
      }
      return a._index - b._index;
    })
    .map(function (s) {
      delete s._langCount;
      delete s._langs;
      delete s._height;
      delete s._index;
      return s;
    });
}
