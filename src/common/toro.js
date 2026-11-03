// Scraper for WordPress sites on the "torofilm" theme (animesalt.cx, watchanimeworld.one).

function toroNorm(s) {
  return String(s || "")
    .toLowerCase()
    .replace(/&#0?38;|&amp;/g, "and")
    .replace(/&#[0-9]+;|&[a-z]+;/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function toroSearch(base, query) {
  return namaFetchText(base + "/?s=" + encodeURIComponent(query)).then(function (html) {
    var out = [];
    html.split("<article").slice(1).forEach(function (block) {
      var href = /href="([^"]+\/(series|movies)\/[^"]+)"/.exec(block);
      if (!href) return;
      var title = /class="entry-title"[^>]*>([^<]+)</.exec(block);
      var poster = /data-src="[^"]*image\.tmdb\.org\/t\/p\/\w+(\/[^"]+)"/.exec(block);
      out.push({
        url: href[1],
        type: href[2] === "movies" ? "movie" : "tv",
        title: title ? title[1].trim() : "",
        poster: poster ? poster[1] : "",
      });
    });
    return out;
  });
}

function toroScore(item, meta) {
  var score = 0;
  // Site titles may carry a year, e.g. "Doraemon (2005)".
  var siteYear = (/\((\d{4})\)\s*$/.exec(item.title) || [])[1];
  var t = toroNorm(item.title.replace(/\(\d{4}\)\s*$/, ""));
  var slug = toroNorm((/\/(?:series|movies)\/([^\/]+)/.exec(item.url) || [])[1]).replace(/ \d{4}$/, "");
  var tc = t.replace(/ /g, "");
  [meta.title, meta.original].concat(meta.altTitles || []).forEach(function (name) {
    var n = toroNorm(name);
    if (!n) return;
    var nc = n.replace(/ /g, "");
    if (t === n || slug === n || tc === nc) score = Math.max(score, 100);
    else if (t.indexOf(n) >= 0 || n.indexOf(t) >= 0 || (tc.length > 3 && nc.indexOf(tc) >= 0)) score = Math.max(score, 60);
    else {
      var words = n.split(" ");
      var hit = words.filter(function (w) {
        return (" " + t + " ").indexOf(" " + w + " ") >= 0;
      }).length;
      score = Math.max(score, Math.round((40 * hit) / words.length));
    }
  });
  if (meta.poster && item.poster === meta.poster) score += 80;
  if (siteYear && meta.year) score += siteYear === meta.year ? 40 : -40;
  if (item.type === meta.type) score += 20;
  else score -= 50;
  return score;
}

var TORO_MAX_ALT_QUERIES = 3;

function toroQueries(meta) {
  var qs = [meta.title, meta.original];
  if (meta.title && meta.title.indexOf(":") > 0) qs.push(meta.title.split(":")[0]);
  qs = qs.concat((meta.altTitles || []).slice(0, TORO_MAX_ALT_QUERIES));
  var seen = {};
  return qs.filter(function (q) {
    var k = toroNorm(q);
    if (!k || seen[k]) return false;
    seen[k] = true;
    return true;
  });
}

// Finds the best matching /series/ or /movies/ page for the TMDB meta.
function toroFindTitle(base, meta) {
  var queries = toroQueries(meta);
  var best = null;
  function next(i) {
    if (i >= queries.length || (best && best.score >= 100)) return Promise.resolve(best);
    return toroSearch(base, queries[i])
      .then(function (items) {
        items.forEach(function (it) {
          var s = toroScore(it, meta);
          if (s >= 50 && (!best || s > best.score)) best = { url: it.url, score: s };
        });
      })
      .catch(function () {})
      .then(function () {
        return next(i + 1);
      });
  }
  return next(0).then(function (b) {
    return b ? b.url : null;
  });
}

function toroEpisodeLinks(html) {
  var re = /href="(https?:\/\/[^"]+\/episode\/([^"\/]+)-(\d+)x(\d+)\/?)"/g;
  var out = [];
  var m;
  while ((m = re.exec(html))) out.push({ url: m[1], s: +m[3], e: +m[4] });
  return out;
}

function toroHasEmbed(html) {
  return /\/video\/[a-f0-9]{32}/i.test(html);
}

// Returns { url, html } of the episode page for TMDB season/episode.
function toroFindEpisode(base, seriesUrl, meta) {
  var slug = (/\/series\/([^\/]+)/.exec(seriesUrl) || [])[1];
  var direct = base + "/episode/" + slug + "-" + meta.season + "x" + meta.episode + "/";
  return namaFetchText(direct)
    .then(function (html) {
      if (toroHasEmbed(html)) return { url: direct, html: html };
      throw new Error("no embed");
    })
    .catch(function () {
      return toroAllEpisodes(base, seriesUrl).then(function (eps) {
        // Site seasons often differ from TMDB: episode numbers are usually absolute.
        var pick =
          eps.filter(function (x) {
            return x.e === meta.absEpisode;
          })[0] || eps[meta.absEpisode - 1];
        if (!pick) return null;
        return namaFetchText(pick.url).then(function (html) {
          return { url: pick.url, html: html };
        });
      });
    });
}

function toroAllEpisodes(base, seriesUrl) {
  return namaFetchText(seriesUrl).then(function (html) {
    var post = (/data-post="(\d+)"/.exec(html) || [])[1];
    var seasons = [];
    var re = /data-season="(\d+)"/g;
    var m;
    while ((m = re.exec(html))) if (seasons.indexOf(m[1]) < 0) seasons.push(m[1]);
    var all = toroEpisodeLinks(html);
    var jobs = post
      ? seasons.map(function (s) {
          return namaFetchText(base + "/wp-admin/admin-ajax.php", {
            method: "POST",
            headers: {
              "Content-Type": "application/x-www-form-urlencoded",
              "X-Requested-With": "XMLHttpRequest",
              Referer: seriesUrl,
            },
            body: "action=action_select_season&season=" + s + "&post=" + post,
          })
            .then(toroEpisodeLinks)
            .catch(function () {
              return [];
            });
        })
      : [];
    return Promise.all(jobs).then(function (lists) {
      lists.forEach(function (l) {
        all = all.concat(l);
      });
      var seen = {};
      return all
        .filter(function (x) {
          if (seen[x.url]) return false;
          seen[x.url] = true;
          return true;
        })
        .sort(function (a, b) {
          return a.s - b.s || a.e - b.e;
        });
    });
  });
}

// Entry point shared by every torofilm provider.
function toroGetStreams(site, tmdbId, mediaType, season, episode) {
  var meta;
  return tmdbMeta(tmdbId, mediaType, season, episode)
    .then(function (m) {
      meta = m;
      return toroFindTitle(site.base, meta);
    })
    .then(function (pageUrl) {
      if (!pageUrl) return null;
      if (meta.type === "movie") {
        return namaFetchText(pageUrl).then(function (html) {
          return { url: pageUrl, html: html };
        });
      }
      return toroFindEpisode(site.base, pageUrl, meta);
    })
    .then(function (page) {
      if (!page) return [];
      var embeds = fpExtractEmbeds(page.html);
      return Promise.all(
        embeds.map(function (emb) {
          return fpStreams(emb, site, meta).catch(function () {
            return [];
          });
        })
      ).then(function (lists) {
        return namaSortStreams([].concat.apply([], lists));
      });
    })
    .catch(function (e) {
      console.log("[" + site.name + "] " + (e && e.message));
      return [];
    });
}
