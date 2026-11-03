// FirePlayer/VPlayer hosts (ravok.buzz, play.zephyrix.org, ...): getVideo -> HLS master,
// then one multi-audio playlist per wanted resolution.

// "data": one data: URI playlist per resolution (1080p, 720p), each with every audio track.
// "master": the original master playlist (all resolutions, player picks quality).
var PER_RES_MODE = "data";
var WANTED_HEIGHTS = [1080, 720];
// Also emit one stream per audio language (only with PER_RES_MODE "data").
var PER_LANGUAGE = true;

function fpExtractEmbeds(html) {
  var re = /(https?:)?\/\/([a-z0-9.-]+)\/video\/([a-f0-9]{32})/gi;
  var seen = {};
  var out = [];
  var m;
  while ((m = re.exec(html))) {
    var host = m[2].toLowerCase();
    var key = host + "/" + m[3].toLowerCase();
    if (seen[key]) continue;
    seen[key] = true;
    out.push({ host: host, origin: "https://" + host, hash: m[3].toLowerCase() });
  }
  return out;
}

function fpHeaders(emb) {
  return { Referer: emb.origin + "/", Origin: emb.origin, "User-Agent": NAMA_UA };
}

function fpGetMasterUrl(emb, site) {
  return namaFetchJson(emb.origin + "/player/index.php?data=" + emb.hash + "&do=getVideo", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "X-Requested-With": "XMLHttpRequest",
      Referer: emb.origin + "/video/" + emb.hash,
      Origin: emb.origin,
    },
    body: "hash=" + emb.hash + "&r=" + encodeURIComponent(site.base + "/"),
  }).then(function (j) {
    var link = j.securedLink || j.videoSource;
    if (!link) throw new Error("getVideo: no source");
    return link;
  });
}

function fpAttr(line, name) {
  var m = new RegExp("[:,]" + name + '=("([^"]*)"|[^,]*)').exec(line);
  return m ? (m[2] !== undefined ? m[2] : m[1]) : "";
}

// Parses a master playlist; every URI is made absolute.
function fpParseMaster(text, masterUrl) {
  var lines = text.split(/\r?\n/);
  var res = { media: [], variants: [] };
  for (var i = 0; i < lines.length; i++) {
    var line = lines[i].trim();
    if (line.indexOf("#EXT-X-MEDIA:") === 0) {
      var uri = fpAttr(line, "URI");
      if (uri) line = line.replace('URI="' + uri + '"', 'URI="' + namaResolveUrl(uri, masterUrl) + '"');
      res.media.push({
        line: line,
        type: fpAttr(line, "TYPE"),
        lang: fpAttr(line, "LANGUAGE"),
        name: fpAttr(line, "NAME"),
      });
    } else if (line.indexOf("#EXT-X-STREAM-INF:") === 0) {
      var next = (lines[i + 1] || "").trim();
      var h = (/RESOLUTION=\d+x(\d+)/.exec(line) || [])[1];
      if (!h) h = (/NAME="(\d+)p"/.exec(line) || [])[1];
      res.variants.push({ inf: line, uri: namaResolveUrl(next, masterUrl), height: +h || 0 });
      i++;
    }
  }
  return res;
}

// onlyAudio: keep just that audio rendition (as the default) for a per-language stream.
function fpBuildPlaylist(parsed, variant, onlyAudio) {
  var out = ["#EXTM3U", "#EXT-X-VERSION:3"];
  parsed.media.forEach(function (m) {
    if (m.type === "SUBTITLES") out.push(m.line);
    else if (m.type === "AUDIO" && !onlyAudio) out.push(m.line);
    else if (m === onlyAudio) out.push(m.line.replace(/DEFAULT=NO/, "DEFAULT=YES"));
  });
  out.push(variant.inf, variant.uri);
  return out.join("\n") + "\n";
}

function fpStreams(emb, site, meta) {
  var headers = fpHeaders(emb);
  return fpGetMasterUrl(emb, site).then(function (masterUrl) {
    return namaFetchText(masterUrl, { headers: headers }).then(function (text) {
      var parsed = fpParseMaster(text, masterUrl);
      var audios = parsed.media.filter(function (m) {
        return m.type === "AUDIO";
      });
      var base = { site: site, meta: meta, host: emb.host, audios: audios, headers: headers };
      if (PER_RES_MODE === "master" || !parsed.variants.length) {
        var heights = parsed.variants
          .map(function (v) {
            return v.height;
          })
          .filter(function (h) {
            return WANTED_HEIGHTS.indexOf(h) >= 0;
          });
        return [namaFormatStream(base, masterUrl, heights.length ? heights : [0])];
      }
      var streams = [];
      var heightsWanted = WANTED_HEIGHTS.filter(function (h) {
        return parsed.variants.some(function (x) {
          return x.height === h;
        });
      });
      // Older shows (e.g. Doraemon 1979) top out below 720p: offer the best there is.
      if (!heightsWanted.length) {
        heightsWanted = [
          Math.max.apply(
            null,
            parsed.variants.map(function (x) {
              return x.height;
            })
          ),
        ];
      }
      heightsWanted.forEach(function (h) {
        var v = parsed.variants.filter(function (x) {
          return x.height === h;
        })[0];
        if (!v) return;
        var url = "data:application/vnd.apple.mpegurl;base64," + namaBase64(fpBuildPlaylist(parsed, v));
        streams.push(namaFormatStream(base, url, [h]));
        if (!PER_LANGUAGE || audios.length < 2) return;
        audios.forEach(function (a) {
          var one = Object.assign({}, base, { audios: [a], perLanguage: true });
          var langUrl = "data:application/vnd.apple.mpegurl;base64," + namaBase64(fpBuildPlaylist(parsed, v, a));
          streams.push(namaFormatStream(one, langUrl, [h]));
        });
      });
      return streams;
    });
  });
}
