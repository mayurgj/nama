// MultiMovies (multimovies.wtf -> current mirror): every watch page lists third-party
// servers (watchConfig.initialServers). Each server gets an extractor below; HLS audio
// languages are merged into one multi-audio stream per resolution.
var SITE = { name: "MultiMovies", base: "https://m1.multimovies.courses" };
var MM_HOME = "https://multimovies.wtf/";
// Most audio languages merged into one stream (Indian, EN and JA are picked first).
var MM_MAX_AUDIO = 6;
// Audio playlists whose length differs from the base by more than this are another cut.
var MM_MAX_DRIFT = 3;
// Some mirror CDNs never answer: give up on a mirror, and on a whole server, after this.
var MM_MIRROR_TIMEOUT = 15000;
var MM_SERVER_TIMEOUT = 30000;
// Per playlist fetch: some proxy workers hang for over a minute.
var MM_FETCH_TIMEOUT = 8000;

var MM_LANG_ISO = {
  hindi: "hi", tamil: "ta", telugu: "te", malayalam: "ml", bengali: "bn", kannada: "kn",
  marathi: "mr", english: "en", japanese: "ja", korean: "ko", chinese: "zh", mandarin: "zh",
  french: "fr", spanish: "es", "latin american spanish": "es", russian: "ru", arabic: "ar",
  indonesian: "id", tagalog: "tl", filipino: "tl", portuguese: "pt", "brazilian portuguese": "pt",
  kurdish: "ku", german: "de", italian: "it", turkish: "tr", thai: "th", urdu: "ur",
  punjabi: "pa", gujarati: "gu", odia: "or", vietnamese: "vi", malay: "ms",
  // Filmu's short labels.
  esla: "es", ptbr: "pt",
};

function mmFetch(url, headers) {
  var h = Object.assign({ "User-Agent": NAMA_UA }, headers || {});
  return fetch(url, { headers: h }).then(function (res) {
    if (!res.ok) throw new Error("HTTP " + res.status + " " + url);
    return res.text().then(function (text) {
      return { url: res.url || url, text: text };
    });
  });
}

function mmTimeout(promise, ms) {
  return Promise.race([
    promise,
    new Promise(function (_, reject) {
      setTimeout(function () {
        reject(new Error("timeout"));
      }, ms);
    }),
  ]);
}

// Playlist fetch with a timeout and one retry (proxy workers drop requests under load).
function mmFetchPlaylist(url, headers) {
  function once() {
    return mmTimeout(namaFetchText(url, { headers: headers }), MM_FETCH_TIMEOUT);
  }
  return once().catch(once);
}

function mmHtmlDecode(s) {
  return String(s || "").replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#0?39;/g, "'");
}

// Balanced-brace JSON value that starts right after `marker`.
function mmJsonAfter(text, marker) {
  var i = text.indexOf(marker);
  if (i < 0) return null;
  i += marker.length;
  while (text.charAt(i) === " ") i++;
  var open = text.charAt(i);
  var close = open === "[" ? "]" : "}";
  var depth = 0;
  var inStr = false;
  for (var j = i; j < text.length; j++) {
    var c = text.charAt(j);
    if (inStr) {
      if (c === "\\") j++;
      else if (c === '"') inStr = false;
    } else if (c === '"') inStr = true;
    else if (c === open) depth++;
    else if (c === close && --depth === 0) return JSON.parse(text.slice(i, j + 1));
  }
  return null;
}

// ---- byte helpers (Hermes has no atob/TextDecoder) ----

function mmB64Bytes(s) {
  s = s.replace(/-/g, "+").replace(/_/g, "/").replace(/[^A-Za-z0-9+\/]/g, "");
  var out = [];
  var buf = 0;
  var bits = 0;
  for (var i = 0; i < s.length; i++) {
    buf = (buf << 6) | NAMA_B64.indexOf(s.charAt(i));
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out.push((buf >> bits) & 255);
    }
  }
  return out;
}

function mmUtf8(bytes) {
  var s = "";
  for (var i = 0; i < bytes.length; i++) {
    var b = bytes[i];
    if (b < 0x80) s += String.fromCharCode(b);
    else if (b < 0xe0) s += String.fromCharCode(((b & 31) << 6) | (bytes[++i] & 63));
    else if (b < 0xf0) s += String.fromCharCode(((b & 15) << 12) | ((bytes[++i] & 63) << 6) | (bytes[++i] & 63));
    else {
      var cp = ((b & 7) << 18) | ((bytes[++i] & 63) << 12) | ((bytes[++i] & 63) << 6) | (bytes[++i] & 63);
      cp -= 0x10000;
      s += String.fromCharCode(0xd800 + (cp >> 10), 0xdc00 + (cp & 1023));
    }
  }
  return s;
}

function mmSha256Hex(ascii) {
  var K = [];
  var H = [];
  var n = 2;
  var found = 0;
  function frac(x) {
    return ((x - Math.floor(x)) * 4294967296) | 0;
  }
  while (found < 64) {
    var prime = true;
    for (var d = 2; d * d <= n; d++) if (n % d === 0) prime = false;
    if (prime) {
      if (found < 8) H[found] = frac(Math.pow(n, 1 / 2));
      K[found++] = frac(Math.pow(n, 1 / 3));
    }
    n++;
  }
  var bytes = [];
  for (var i = 0; i < ascii.length; i++) bytes.push(ascii.charCodeAt(i) & 255);
  var bitLen = bytes.length * 8;
  bytes.push(0x80);
  while (bytes.length % 64 !== 56) bytes.push(0);
  for (var s = 7; s >= 0; s--) bytes.push(s > 3 ? 0 : (bitLen >>> (s * 8)) & 255);
  function rot(x, r) {
    return (x >>> r) | (x << (32 - r));
  }
  for (var off = 0; off < bytes.length; off += 64) {
    var w = [];
    for (var t = 0; t < 64; t++) {
      if (t < 16) {
        var p = off + t * 4;
        w[t] = (bytes[p] << 24) | (bytes[p + 1] << 16) | (bytes[p + 2] << 8) | bytes[p + 3];
      } else {
        var s0 = rot(w[t - 15], 7) ^ rot(w[t - 15], 18) ^ (w[t - 15] >>> 3);
        var s1 = rot(w[t - 2], 17) ^ rot(w[t - 2], 19) ^ (w[t - 2] >>> 10);
        w[t] = (w[t - 16] + s0 + w[t - 7] + s1) | 0;
      }
    }
    var a = H[0], b = H[1], c = H[2], dd = H[3], e = H[4], f = H[5], g = H[6], h = H[7];
    for (var r = 0; r < 64; r++) {
      var t1 = (h + (rot(e, 6) ^ rot(e, 11) ^ rot(e, 25)) + ((e & f) ^ (~e & g)) + K[r] + w[r]) | 0;
      var t2 = ((rot(a, 2) ^ rot(a, 13) ^ rot(a, 22)) + ((a & b) ^ (a & c) ^ (b & c))) | 0;
      h = g; g = f; f = e; e = (dd + t1) | 0; dd = c; c = b; b = a; a = (t1 + t2) | 0;
    }
    H = [(H[0] + a) | 0, (H[1] + b) | 0, (H[2] + c) | 0, (H[3] + dd) | 0, (H[4] + e) | 0, (H[5] + f) | 0, (H[6] + g) | 0, (H[7] + h) | 0];
  }
  return H.map(function (x) {
    return ("00000000" + (x >>> 0).toString(16)).slice(-8);
  }).join("");
}

// ---- HLS: multi-audio playlists ----

function mmLangOf(label, meta) {
  var l = String(label || "").toLowerCase().trim();
  // MovieBox "<language> sub" sources carry the original audio.
  if (/\bsub(s|titles?)?$/.test(l) || l === "original" || /orion · original/.test(l)) return meta.originalLanguage || "";
  l = l.replace(/^.*·\s*/, "").replace(/\s*\(.*\)$/, "");
  return MM_LANG_ISO[l] || "";
}

function mmLangName(iso) {
  for (var k in MM_LANG_ISO) if (MM_LANG_ISO[k] === iso) return k.charAt(0).toUpperCase() + k.slice(1);
  return iso.toUpperCase();
}

function mmLangRank(iso) {
  var i = NAMA_LANG_ORDER.indexOf(String(iso).toUpperCase());
  return i < 0 ? 99 : i;
}

function mmPlaylistSeconds(url, headers) {
  return mmFetchPlaylist(url, headers).then(function (t) {
    var sum = 0;
    var re = /#EXTINF:([0-9.]+)/g;
    var m;
    while ((m = re.exec(t))) sum += parseFloat(m[1]);
    return sum;
  });
}

// One stream per wanted resolution, each carrying every audio rendition of `parsed`.
function mmStreamsFromParsed(parsed, ctx) {
  var heights = WANTED_HEIGHTS.filter(function (h) {
    return parsed.variants.some(function (v) {
      return v.height === h;
    });
  });
  if (!heights.length && parsed.variants.length) {
    heights = [Math.max.apply(null, parsed.variants.map(function (v) {
      return v.height;
    }))];
  }
  var audios = parsed.media.filter(function (m) {
    return m.type === "AUDIO";
  });
  var base = Object.assign({}, ctx, { audios: audios.length ? audios : ctx.fallbackAudio || [] });
  return heights.map(function (h) {
    var v = parsed.variants.filter(function (x) {
      return x.height === h;
    })[0];
    var url = "data:application/vnd.apple.mpegurl;base64," + namaBase64(fpBuildPlaylist(parsed, v));
    return namaFormatStream(base, url, [h], v.inf);
  });
}

// sources: [{ url, label }] HLS masters of the same title, one audio language each (or a
// master that already has several). Returns multi-audio streams for the best video.
function mmHlsStreams(sources, ctx) {
  var headers = ctx.headers;
  return Promise.all(
    sources.map(function (s) {
      return mmFetchPlaylist(s.url, headers)
        .then(function (text) {
          var parsed = fpParseMaster(text, s.url);
          var iso = mmLangOf(s.label, ctx.meta);
          // Unlabelled renditions ("Audio") take the source's language.
          parsed.media.forEach(function (m) {
            if (m.type === "AUDIO" && !m.lang && iso) m.lang = iso;
          });
          return { src: s, parsed: parsed, iso: iso };
        })
        .catch(function () {
          return null;
        });
    })
  ).then(function (list) {
    list = list.filter(function (x) {
      return x && x.parsed.variants.length;
    });
    if (!list.length) return [];
    if (list.length === 1) {
      var only = list[0];
      if (!only.parsed.media.some(function (m) {
        return m.type === "AUDIO";
      }) && only.iso) {
        ctx = Object.assign({}, ctx, { fallbackAudio: [{ lang: only.iso, name: mmLangName(only.iso) }] });
      }
      return mmStreamsFromParsed(only.parsed, ctx);
    }
    return mmMergeAudio(list, ctx);
  });
}

function mmMergeAudio(list, ctx) {
  // Separate audio renditions only; muxed sources can't be merged.
  var cands = [];
  var seen = {};
  list
    .slice()
    .sort(function (a, b) {
      return mmLangRank(a.iso) - mmLangRank(b.iso);
    })
    .forEach(function (x) {
      var a = x.parsed.media.filter(function (m) {
        return m.type === "AUDIO" && fpAttr(m.line, "URI");
      })[0];
      var iso = x.iso || (a && a.lang) || "";
      if (!a || !x.parsed.variants[0].inf.match(/AUDIO="/) || seen[iso || x.src.url]) return;
      seen[iso || x.src.url] = true;
      cands.push({ x: x, iso: iso, uri: fpAttr(a.line, "URI"), channels: fpAttr(a.line, "CHANNELS"), name: x.iso ? mmLangName(x.iso) : x.src.label || a.name || "Audio" });
    });
  if (!cands.length) return mmStreamsFromParsed(list[0].parsed, ctx);
  cands = cands.slice(0, MM_MAX_AUDIO + 2);
  return Promise.all(
    cands.map(function (c) {
      return mmPlaylistSeconds(c.uri, ctx.headers).catch(function () {
        return -1;
      });
    })
  ).then(function (secs) {
    // The base is the first language whose audio loaded.
    var baseSec = secs.filter(function (x) {
      return x > 0;
    })[0];
    var keep = cands
      .filter(function (c, i) {
        return secs[i] > 0 && Math.abs(secs[i] - baseSec) <= MM_MAX_DRIFT;
      })
      .slice(0, MM_MAX_AUDIO);
    if (!keep.length) return [];
    var base = keep[0].x.parsed;
    var media = base.media.filter(function (m) {
      return m.type === "SUBTITLES";
    });
    keep.forEach(function (c, i) {
      var line =
        '#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="mmaud",NAME="' + c.name + '",LANGUAGE="' + (c.iso || "und") +
        '",DEFAULT=' + (i ? "NO" : "YES") + ',AUTOSELECT=YES' +
        (c.channels ? ',CHANNELS="' + c.channels + '"' : "") + ',URI="' + c.uri + '"';
      media.push({ line: line, type: "AUDIO", lang: c.iso, name: c.name });
    });
    var variants = base.variants.map(function (v) {
      return Object.assign({}, v, { inf: v.inf.replace(/AUDIO="[^"]*"/, 'AUDIO="mmaud"') });
    });
    return mmStreamsFromParsed({ media: media, variants: variants }, ctx);
  });
}

function mmMp4Stream(url, label, height, ctx) {
  var iso = mmLangOf(label, ctx.meta);
  var c = Object.assign({}, ctx, { audios: iso ? [{ lang: iso, name: mmLangName(iso) }] : [], format: "MP4" });
  return namaFormatStream(c, url, [height || 0]);
}

function mmQualityHeight(q) {
  return +((/(\d{3,4})p/.exec(q || "") || [])[1] || 0);
}

// Sources with a known language first, original-language "sub" duplicates dropped.
function mmPickSources(list, meta) {
  var seen = {};
  return list
    .map(function (s) {
      return Object.assign({}, s, { iso: mmLangOf(s.label, meta) });
    })
    .filter(function (s) {
      var k = s.iso || "?" + s.label;
      if (seen[k]) return false;
      seen[k] = true;
      return true;
    })
    .sort(function (a, b) {
      return mmLangRank(a.iso) - mmLangRank(b.iso);
    });
}

// ---- packed JWPlayer hosts (StreamHG, EarnVids/FileLions) ----

function mmUnpack(html) {
  var m = /eval\(function\(p,a,c,k,e,d\)\{[\s\S]*?\}\('([\s\S]*?)',(\d+),(\d+),'([\s\S]*?)'\.split\('\|'\)/.exec(html);
  if (!m) return "";
  var p = m[1];
  var a = +m[2];
  var c = +m[3];
  var k = m[4].split("|");
  function enc(n) {
    return (n < a ? "" : enc(Math.floor(n / a))) + ((n = n % a) > 35 ? String.fromCharCode(n + 29) : n.toString(36));
  }
  while (c--) if (k[c]) p = p.replace(new RegExp("\\b" + enc(c) + "\\b", "g"), k[c]);
  return p;
}

function mmPackedStreams(embedUrl, referer, ctx) {
  return mmFetch(embedUrl, { Referer: referer }).then(function (page) {
    var js = mmUnpack(page.text);
    var links = {};
    var lm = /links\s*=\s*(\{[^}]*\})/.exec(js);
    if (lm) links = JSON.parse(lm[1]);
    // hls4 is served by the embed host itself; the hls2 CDN sometimes never answers.
    var file = links.hls4 || links.hls2 || links.hls3 || (/file\s*:\s*"([^"]+\.(?:m3u8|txt)[^"]*)"/.exec(js) || [])[1];
    if (!file) throw new Error("packed: no source");
    var origin = namaOrigin(page.url);
    var headers = { Referer: origin + "/", Origin: origin, "User-Agent": NAMA_UA };
    var c = Object.assign({}, ctx, { headers: headers, host: namaHost(page.url) });
    return mmHlsStreams([{ url: namaResolveUrl(file, page.url), label: "" }], c);
  });
}

function mmFirstOk(tasks) {
  var i = 0;
  function next() {
    if (i >= tasks.length) return Promise.resolve([]);
    return mmTimeout(tasks[i++](), MM_MIRROR_TIMEOUT)
      .catch(function () {
        return [];
      })
      .then(function (s) {
        return s.length ? s : next();
      });
  }
  return next();
}

// ---- extractors, one per server host ----

function mmVidrift(srv, ctx) {
  var origin = namaOrigin(srv.url);
  var headers = { Referer: origin + "/", Origin: origin, "User-Agent": NAMA_UA };
  var c = Object.assign({}, ctx, { headers: headers, host: namaHost(srv.url) });
  return mmFetch(srv.url, { Referer: SITE.base + "/" }).then(function (page) {
    var em = mmJsonAfter(page.text, "var embedMeta =") || {};
    var orion = em.orionStreams;
    if (orion && orion.length) return mmVidriftStreams(orion, origin, c);
    var path = /\/embed\/(movie\/\d+|tv\/\d+\/\d+\/\d+)/.exec(srv.url)[1];
    var providers = ["orion", "animedub", "anime", "vela"];
    return mmFirstOk(
      providers.map(function (p) {
        return function () {
          var q = "?token=" + encodeURIComponent(em.playbackToken || "") + "&provider=" + p + "&parent=" + encodeURIComponent(em.parent || "");
          return namaFetchJson(origin + "/api/source/" + path + q, { headers: { Referer: srv.url } }).then(function (d) {
            return mmVidriftStreams(d.streams || [], origin, c);
          });
        };
      })
    );
  });
}

function mmVidriftStreams(list, origin, ctx) {
  var hls = [];
  var mp4 = [];
  list.forEach(function (s) {
    var u = s.url || s.proxyUrl;
    if (!u) return;
    var item = { url: namaResolveUrl(u, origin + "/"), label: s.name || "" };
    (s.type === "mp4" ? mp4 : hls).push(item);
  });
  return mmHlsStreams(mmPickSources(hls, ctx.meta), ctx).then(function (streams) {
    if (streams.length) return streams;
    return mmPickSources(mp4, ctx.meta).slice(0, 1).map(function (s) {
      return mmMp4Stream(s.url, s.label, 0, ctx);
    });
  });
}

function mmVidbolt(srv, ctx) {
  var origin = namaOrigin(srv.url);
  var m = /\/(movie|tv)\/(\d+)(?:\/(\d+)\/(\d+))?/.exec(srv.url);
  var q = m[1] === "movie" ? "type=movie&id=" + m[2] : "type=tv&id=" + m[2] + "&season=" + m[3] + "&episode=" + m[4];
  var headers = { Referer: origin + "/", Origin: origin, "User-Agent": NAMA_UA };
  var c = Object.assign({}, ctx, { headers: headers, host: namaHost(srv.url) });
  return namaFetchJson(origin + "/api/resolve?" + q, { headers: { Referer: srv.url } }).then(function (j) {
    var sources = ((j.stream && j.stream.sources) || []).filter(function (s) {
      return s.kind === "hls";
    });
    return mmHlsStreams(
      mmPickSources(
        sources.map(function (s) {
          return { url: s.url, label: s.language };
        }),
        ctx.meta
      ),
      c
    );
  });
}

// Filmu (embed.filmu.in -> vidly.pro): the stream list ships "sealed" in the RSC payload.
var MM_FILMU_KEY = "vY7#qL2!mZ9@wK4$";

function mmFilmuUnseal(sealed) {
  var all = mmB64Bytes(sealed.slice(3));
  var nonce = all.slice(0, 12);
  var data = all.slice(12);
  var st = [];
  for (var s = 0; s < 4; s++) {
    var n = (0x811c9dc5 ^ (0x9e3779b9 * s)) >>> 0;
    for (var i = 0; i < MM_FILMU_KEY.length; i++) n = Math.imul(n ^ MM_FILMU_KEY.charCodeAt(i), 0x1000193) >>> 0;
    for (var j = 0; j < nonce.length; j++) n = Math.imul(n ^ nonce[j], 0x1000193) >>> 0;
    st.push(n);
  }
  var a = st[0], b = st[1], c = st[2], d = st[3], r = 0;
  for (var t = 0; t < data.length; t++) {
    if ((t & 3) === 0) {
      c >>>= 0;
      d >>>= 0;
      var e = ((a >>>= 0) + (b >>>= 0)) | 0;
      a = b ^ (b >>> 9);
      b = (c + (c << 3)) | 0;
      c = ((c << 21) | (c >>> 11));
      d = (d + 1) | 0;
      e = (e + d) | 0;
      c = (c + e) | 0;
      r = e >>> 0;
    }
    data[t] ^= (r >>> ((t & 3) * 8)) & 255;
  }
  return JSON.parse(mmUtf8(data));
}

function mmFilmu(srv, ctx) {
  return mmFetch(srv.url, { Referer: SITE.base + "/" }).then(function (page) {
    var rsc = "";
    var re = /self\.__next_f\.push\(\[1,"((?:[^"\\]|\\.)*)"\]\)/g;
    var m;
    while ((m = re.exec(page.text))) rsc += JSON.parse('"' + m[1] + '"');
    var ref = /"sealed":"\$([0-9a-f]+)"/.exec(rsc);
    var sealed;
    if (ref) {
      var row = new RegExp("(?:^|\\n)" + ref[1] + ":T([0-9a-f]+),").exec(rsc);
      if (row) sealed = rsc.substr(row.index + row[0].length, parseInt(row[1], 16));
    } else sealed = (/"sealed":"(v1\.[A-Za-z0-9_-]+)"/.exec(rsc) || [])[1];
    if (!sealed) throw new Error("filmu: no sealed payload");
    var data = mmFilmuUnseal(sealed);
    var origin = namaOrigin(page.url);
    var headers = { Referer: origin + "/", Origin: origin, "User-Agent": NAMA_UA };
    var c = Object.assign({}, ctx, { headers: headers, host: namaHost(page.url) });
    var hls = (data.streams || []).filter(function (s) {
      return s.type === "hls";
    });
    return mmHlsStreams(
      mmPickSources(
        hls.map(function (s) {
          return { url: s.url, label: s.language };
        }),
        ctx.meta
      ),
      c
    );
  });
}

// Nexus (moviesnexus.fun): server action token + sha256 proof of work -> /api/extract.
var MM_NEXUS_ACTION = "6083fa9bf317439b0ab1f882f7ba7ccd49d1369361";
var MM_NEXUS_KEY = "nexus-super-secret-key-999";

function mmNexusDecode(s) {
  if (!/^[0-9a-f]+$/i.test(s || "")) return s;
  var out = "";
  for (var i = 0; i < s.length; i += 2) {
    out += String.fromCharCode(parseInt(s.substr(i, 2), 16) ^ MM_NEXUS_KEY.charCodeAt((i / 2) % MM_NEXUS_KEY.length));
  }
  return out;
}

function mmNexus(srv, ctx) {
  var origin = namaOrigin(srv.url);
  var m = /\/(movie|tv)\/(\d+)(?:\/(\d+)\/(\d+))?/.exec(srv.url);
  var isTv = m[1] === "tv";
  var page = origin + "/" + (isTv ? "tv/" + m[2] + "/" + m[3] + "/" + m[4] : "movie/" + m[2]);
  var key = isTv ? m[2] + "-s" + m[3] + "e" + m[4] : m[2];
  return namaFetchText(page, {
    method: "POST",
    headers: { "Next-Action": MM_NEXUS_ACTION, Accept: "text/x-component", "Content-Type": "text/plain;charset=UTF-8", Referer: page },
    body: JSON.stringify([key, m[1]]),
  })
    .then(function (t) {
      var tok = JSON.parse((/(?:^|\n)1:(\{.*\})/.exec(t) || [])[1]);
      var answer = "";
      if (tok.challengeSeed) {
        for (var n = 0; n < 200000; n++) {
          if (mmSha256Hex(tok.challengeSeed + ":" + n).indexOf(tok.difficulty || "000") === 0) break;
        }
        answer = String(n);
      }
      var q =
        "mediaType=" + m[1] + "&tmdbId=" + m[2] + (isTv ? "&season=" + m[3] + "&episode=" + m[4] : "") +
        "&token=" + tok.token + "&nonce=" + tok.nonce + "&timestamp=" + tok.timestamp +
        (answer ? "&challengeSeed=" + encodeURIComponent(tok.challengeSeed) + "&challengeAnswer=" + answer : "");
      return namaFetchJson(origin + "/api/extract?" + q, { headers: { Referer: page } });
    })
    .then(function (d) {
      var servers = (d.servers || []).filter(function (s) {
        return s.type === "m3u8" || (s.audioTracks || []).length;
      });
      // Multi-audio servers first.
      servers.sort(function (a, b) {
        return (b.audioTracks || []).length - (a.audioTracks || []).length;
      });
      return Promise.all(
        servers.slice(0, 3).map(function (s) {
          var headers = Object.assign({ "User-Agent": NAMA_UA }, s.headers || {});
          var c = Object.assign({}, ctx, { headers: headers, host: namaHost(origin) });
          var tracks = (s.audioTracks || []).map(function (a) {
            return { url: mmNexusDecode(a.url), label: a.label };
          });
          var list = tracks.length ? mmPickSources(tracks, ctx.meta) : [{ url: mmNexusDecode(s.url), label: "" }];
          return mmHlsStreams(list, c).catch(function () {
            return [];
          });
        })
      ).then(mmBestPerHeight);
    });
}

// IQSmart family (GD mirror, Filesforever): file slug -> embedhelper2 -> mirror hosts.
var MM_IQ_HOSTS = ["smwh", "flls"];

function mmIqHelper(playerBase, slug, ctx) {
  return namaFetchJson(playerBase + "/embedhelper2.php", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Referer: playerBase + "/", Origin: playerBase },
    body: "sid=" + slug + "&UserFavSite=&currentDomain=" + encodeURIComponent(JSON.stringify([namaHost(SITE.base), namaHost(playerBase)])),
  }).then(function (d) {
    var codes = JSON.parse(mmUtf8(mmB64Bytes(d.mresult || "")) || "{}");
    var sources = d.sources || {};
    return mmFirstOk(
      MM_IQ_HOSTS.filter(function (k) {
        return sources[k] && sources[k].siteUrl && codes[k] && /\/[ev]\/$/.test(sources[k].siteUrl);
      }).map(function (k) {
        return function () {
          return mmPackedStreams(sources[k].siteUrl + codes[k], playerBase + "/", ctx);
        };
      })
    );
  });
}

function mmIqsmart(srv, ctx) {
  return mmFetch(srv.url, { Referer: SITE.base + "/" }).then(function (page) {
    function v(name) {
      return (new RegExp("let " + name + ' = "([^"]*)"').exec(page.text) || [])[1] || "";
    }
    var api = v("api_url");
    var player = v("player_base");
    var qs = v("idType") + "=" + v("FinalID") + "&key=" + v("myKey");
    var apiUrl = /myseriesapi/.test(page.text)
      ? api + "/myseriesapi?" + qs.replace("&key", "&season=" + v("season") + "&epname=" + encodeURIComponent(v("epname")) + "&key")
      : api + "/mymovieapi?" + qs;
    return namaFetchJson(apiUrl, { headers: { Referer: srv.url } }).then(function (r) {
      var slugs = (r.data || []).map(function (x) {
        return x.fileslug;
      });
      return mmFirstOk(
        slugs.slice(0, 2).map(function (slug) {
          return function () {
            return mmIqHelper(player, slug, ctx);
          };
        })
      );
    });
  });
}

function mmFilesforever(srv, ctx) {
  return mmFetch(srv.url, { Referer: SITE.base + "/" }).then(function (page) {
    var sid = (/const sid = "([^"]+)"/.exec(page.text) || [])[1] || (/\/embed\/([^\/?#]+)/.exec(srv.url) || [])[1];
    return mmIqHelper(namaOrigin(page.url), sid, ctx);
  });
}

// Cineverse (modiplay): a switcher of StreamHG / EarnVids embeds.
function mmCineverse(srv, ctx) {
  return mmFetch(srv.url, { Referer: SITE.base + "/" }).then(function (page) {
    var urls = [];
    var re = /data-url="(https?:\/\/[^"]+)"/g;
    var m;
    while ((m = re.exec(page.text))) {
      var u = mmHtmlDecode(m[1]);
      if (urls.indexOf(u) < 0 && /\/(e|v|embed)\/[a-z0-9]+/i.test(u)) urls.push(u);
    }
    // StreamHG's own domain is bot-walled; EarnVids answers plain fetches.
    urls.sort(function (a, b) {
      return /shg\./.test(a) - /shg\./.test(b);
    });
    return mmFirstOk(
      urls.map(function (u) {
        return function () {
          return mmPackedStreams(u, page.url, ctx);
        };
      })
    );
  });
}

// VIDOUT (vidout.pages.dev): stream links come from a GitHub-hosted catalogue.
var MM_VIDOUT_DB = "https://raw.githubusercontent.com/Watchout2025/api/refs/heads/main/hls/";

function mmVidout(srv, ctx) {
  var m = /\/(movie|tv)\/(\d+)(?:\/s(\d+)\/e(\d+))?/i.exec(srv.url);
  var tmdb = m && /^\d+$/.test(m[2]) ? m[2] : ctx.meta.tmdbId;
  var isTv = ctx.meta.type === "tv";
  var lookup = isTv
    ? namaFetchJson(MM_VIDOUT_DB + "tv/" + tmdb + "/S" + ctx.meta.season + ".json").then(function (j) {
        return j[String(ctx.meta.episode)] || "";
      })
    : namaFetchText(MM_VIDOUT_DB + "movie/" + tmdb);
  // Titles missing from the catalogue (404) have no VIDOUT stream.
  lookup = lookup.catch(function () {
    return "";
  });
  return lookup.then(function (link) {
    link = String(link || "").trim();
    if (!/^https?:\/\//.test(link) || link.indexOf("#") >= 0) return [];
    if (/\/(e|v|embed)\/[a-z0-9]+$/i.test(link)) return mmPackedStreams(link, "https://vidout.pages.dev/", ctx);
    var origin = "https://vidout.pages.dev";
    var c = Object.assign({}, ctx, { headers: { Referer: origin + "/", Origin: origin, "User-Agent": NAMA_UA }, host: namaHost(link) });
    return mmHlsStreams([{ url: link, label: "" }], c);
  });
}

var MM_EXTRACTORS = [
  { test: /vidrift\./, run: mmVidrift },
  { test: /vidbolt\./, run: mmVidbolt },
  { test: /filmu\.|vidly\./, run: mmFilmu },
  { test: /moviesnexus\./, run: mmNexus },
  { test: /iqsmartgames\.com\/embed\//, run: mmIqsmart },
  { test: /filesforever\.|iqsmartgames\.com\/[se]vid\//, run: mmFilesforever },
  { test: /modiplay\.|cineverse/, run: mmCineverse },
  { test: /vidout\./, run: mmVidout },
];

// Keeps the stream with the most audio languages for each resolution; other
// resolutions only when none of WANTED_HEIGHTS is there.
function mmBestPerHeight(lists) {
  var best = {};
  var all = [].concat.apply([], lists);
  var wanted = all.filter(function (s) {
    return WANTED_HEIGHTS.indexOf(s._height) >= 0;
  });
  (wanted.length ? wanted : all).forEach(function (s) {
    var k = s._height;
    if (!best[k] || s._langCount > best[k]._langCount) best[k] = s;
  });
  return Object.keys(best).map(function (k) {
    return best[k];
  });
}

// ---- site ----

function mmBase() {
  return namaFetchText(MM_HOME)
    .then(function (html) {
      var m = /<a[^>]+href="(https?:\/\/[^"]+)"[^>]*class="cta-primary"/.exec(html) || /class="cta-primary"[^>]*href="(https?:\/\/[^"]+)"/.exec(html);
      return m ? m[1].replace(/\/+$/, "") : SITE.base;
    })
    .catch(function () {
      return SITE.base;
    });
}

function mmSearch(base, query) {
  // The search is literal: "Your Name." and "Dead-End Job" find nothing,
  // "Your Name" and "Dead End Job" do.
  query = query.replace(/[^\w\s'&]+/g, " ").replace(/\s+/g, " ").trim();
  return namaFetchJson(base + "/api/search?q=" + encodeURIComponent(query) + "&limit=20").then(function (d) {
    var list = (d.movies || []).concat(d.tv_shows || []);
    if (!list.length && Array.isArray(d.results)) list = d.results;
    return list.map(function (x) {
      var isMovie = x.type === "movie";
      return {
        url: base + x.url,
        type: isMovie ? "movie" : "tv",
        // toroScore reads a trailing "(year)"; the site's tv years are often the dub's year.
        title: x.title + (isMovie && x.year ? " (" + x.year + ")" : ""),
        poster: (/\/t\/p\/\w+(\/[^"?]+)/.exec(x.poster || "") || [])[1] || "",
      };
    });
  });
}

// Candidate title pages, best match first.
function mmCandidates(base, meta) {
  var found = {};
  return Promise.all(
    toroQueries(meta).map(function (q) {
      return mmSearch(base, q).catch(function () {
        return [];
      });
    })
  ).then(function (lists) {
    [].concat.apply([], lists).forEach(function (it) {
      var s = toroScore(it, meta);
      if (s >= 50 && (!found[it.url] || s > found[it.url].score)) found[it.url] = { url: it.url, score: s };
    });
    return Object.keys(found)
      .map(function (k) {
        return found[k];
      })
      .sort(function (a, b) {
        return b.score - a.score;
      });
  });
}

// Every server but the site's own mirrors takes TMDB ids, so when the title page can't be
// found the list is built here (same URLs the site uses).
var MM_IQ_KEY = "e11a7debaaa4f5d25b671706ffe4d2acb56efbd4";

function mmDirectServers(meta) {
  var id = meta.tmdbId;
  var s = meta.season;
  var e = meta.episode;
  if (meta.type === "movie") {
    return [
      { name: "Cineverse", url: "https://rozgarlelo.modiplay.xyz/embed/tmdb/movie?id=" + id },
      { name: "Nexus", url: "https://www.moviesnexus.fun/movie/" + id + "?sv=multi-audio" },
      { name: "Vidrift", url: "https://embed.vidrift.net/embed/movie/" + id },
      { name: "VIDOUT", url: "https://vidout.pages.dev/movie/" + id },
      { name: "Filmu", url: "https://embed.filmu.in/movie/" + id },
      { name: "VidBolt", url: "https://vidbolt.xyz/movie/" + id },
    ];
  }
  return [
    { name: "Cineverse", url: "https://rozgarlelo.modiplay.xyz/embed/tmdb/tv?id=" + id + "&s=" + s + "&e=" + e },
    { name: "GD mirror", url: "https://streams.iqsmartgames.com/embed/tv/" + id + "/" + s + "/" + e + "?key=" + MM_IQ_KEY },
    { name: "Nexus", url: "https://www.moviesnexus.fun/tv/" + id + "/" + s + "/" + e },
    { name: "Vidrift", url: "https://embed.vidrift.net/embed/tv/" + id + "/" + s + "/" + e },
    { name: "VIDOUT", url: "https://vidout.pages.dev/tv/" + id + "/s" + s + "/e" + e },
    { name: "Filmu", url: "https://embed.filmu.in/tv/" + id + "/" + s + "/" + e },
    { name: "VidBolt", url: "https://vidbolt.xyz/tv/" + id + "/" + s + "/" + e },
  ];
}

function mmWatchServers(pageUrl) {
  return namaFetchText(pageUrl).then(function (html) {
    var cfg = mmJsonAfter(html, "const watchConfig =");
    return (cfg && cfg.initialServers) || [];
  });
}

// The page is right when its server links carry the TMDB id.
function mmServersMatch(servers, meta) {
  var re = new RegExp("[/=]" + meta.tmdbId + "(?:[/?&]|$)");
  return servers.some(function (s) {
    return re.test(s.url || "");
  });
}

// Seasons on the site can differ from TMDB (Naruto: TMDB 1x220, site 4x52 with absolute
// episode numbers), so after the TMDB S/E page, try the site season holding absEpisode.
function mmEpisodeUrls(seriesUrl, meta) {
  var direct = seriesUrl + "/season/" + meta.season + "/episode/" + meta.episode;
  return namaFetchText(seriesUrl)
    .then(function (html) {
      var urls = [direct];
      var before = 0;
      var re = /<option value="(\d+)"[^>]*>\s*Season \d+\s*·\s*(\d+) episodes/g;
      var m;
      while ((m = re.exec(html))) {
        var count = +m[2];
        if (meta.absEpisode > before && meta.absEpisode <= before + count) {
          urls.push(seriesUrl + "/season/" + m[1] + "/episode/" + meta.absEpisode);
          urls.push(seriesUrl + "/season/" + m[1] + "/episode/" + (meta.absEpisode - before));
        }
        before += count;
      }
      return urls.filter(function (u, i) {
        return urls.indexOf(u) === i;
      });
    })
    .catch(function () {
      return [direct];
    });
}

function mmFindServers(base, meta) {
  return mmCandidates(base, meta).then(function (cands) {
    var urls = [];
    var ci = 0;
    function next() {
      if (urls.length) {
        return mmWatchServers(urls.shift())
          .then(function (servers) {
            return servers.length && mmServersMatch(servers, meta) ? servers : next();
          })
          .catch(next);
      }
      if (ci >= Math.min(cands.length, 3)) return [];
      var c = cands[ci++];
      if (meta.type === "movie") urls = [c.url];
      else
        return mmEpisodeUrls(c.url, meta).then(function (list) {
          urls = list;
          return next();
        });
      return next();
    }
    return next();
  });
}

function getStreams(tmdbId, mediaType, season, episode) {
  var meta;
  return tmdbMeta(tmdbId, mediaType, season, episode)
    .then(function (m) {
      meta = m;
      return mmBase();
    })
    .then(function (base) {
      SITE.base = base;
      return mmFindServers(base, meta);
    })
    .then(function (servers) {
      return servers.length ? servers : mmDirectServers(meta);
    })
    .then(function (servers) {
      return Promise.all(
        servers.map(function (srv) {
          var ex = MM_EXTRACTORS.filter(function (x) {
            return x.test.test(srv.url || "");
          })[0];
          if (!ex) return [];
          var ctx = { site: SITE, server: srv.name, meta: meta, host: namaHost(srv.url), audios: [] };
          return mmTimeout(ex.run(srv, ctx), MM_SERVER_TIMEOUT)
            .then(function (streams) {
              return mmBestPerHeight([streams]);
            })
            .catch(function (e) {
              console.log("[MultiMovies] " + srv.name + ": " + (e && e.message));
              return [];
            });
        })
      );
    })
    .then(function (lists) {
      return namaSortStreams([].concat.apply([], lists));
    })
    .catch(function (e) {
      console.log("[MultiMovies] " + (e && e.message));
      return [];
    });
}
