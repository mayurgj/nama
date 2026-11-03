// TMDB metadata lookup. Get a free v3 API key at https://www.themoviedb.org/settings/api
// and put it here before building.
var TMDB_API_KEY = "PUT_YOUR_TMDB_API_KEY_HERE";
// api.themoviedb.org is blocked on many Indian networks; api.tmdb.org is the same API.
var TMDB_BASES = ["https://api.tmdb.org/3", "https://api.themoviedb.org/3"];

function tmdbGet(path) {
  var sep = path.indexOf("?") >= 0 ? "&" : "?";
  var q = path + sep + "api_key=" + TMDB_API_KEY;
  return namaFetchJson(TMDB_BASES[0] + q).catch(function () {
    return namaFetchJson(TMDB_BASES[1] + q);
  });
}

// Resolves "tt..." IMDb ids to a TMDB id.
function tmdbResolveId(id, mediaType) {
  id = String(id);
  if (id.indexOf("tt") !== 0) return Promise.resolve(id);
  return tmdbGet("/find/" + id + "?external_source=imdb_id").then(function (r) {
    var list = mediaType === "movie" ? r.movie_results : r.tv_results;
    if (!list || !list.length) throw new Error("TMDB: no match for " + id);
    return String(list[0].id);
  });
}

// Returns { type, tmdbId, originalLanguage, title, original, year, poster, season, episode, absEpisode, episodeName, altTitles }.
function tmdbMeta(tmdbId, mediaType, season, episode) {
  var isMovie = mediaType === "movie";
  return tmdbResolveId(tmdbId, mediaType)
    .then(function (id) {
      return tmdbGet((isMovie ? "/movie/" : "/tv/") + id);
    })
    .then(function (d) {
      var meta = {
        type: isMovie ? "movie" : "tv",
        tmdbId: String(d.id),
        originalLanguage: d.original_language || "",
        title: isMovie ? d.title : d.name,
        original: isMovie ? d.original_title : d.original_name,
        year: ((isMovie ? d.release_date : d.first_air_date) || "").slice(0, 4),
        poster: d.poster_path || "",
        season: season,
        episode: episode,
        absEpisode: episode,
        episodeName: "",
        altTitles: [],
      };
      return tmdbAltTitles(d.id, isMovie)
        .then(function (alts) {
          meta.altTitles = alts;
        })
        .then(function () {
          return tmdbEpisodeMeta(d, meta);
        });
    });
}

// Regional titles help where the site uses a local name (e.g. "Shin-Chan" for "Crayon Shin-chan").
var TMDB_ALT_COUNTRIES = ["IN", "US", "GB"];

function tmdbAltTitles(id, isMovie) {
  return tmdbGet((isMovie ? "/movie/" : "/tv/") + id + "/alternative_titles")
    .then(function (r) {
      var list = (isMovie ? r.titles : r.results) || [];
      return list
        .filter(function (x) {
          return /^[\x20-\x7e]+$/.test(x.title || "");
        })
        .sort(function (a, b) {
          var ia = TMDB_ALT_COUNTRIES.indexOf(a.iso_3166_1);
          var ib = TMDB_ALT_COUNTRIES.indexOf(b.iso_3166_1);
          return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
        })
        .map(function (x) {
          return x.title;
        });
    })
    .catch(function () {
      return [];
    });
}

// Adds absolute episode number and episode name for tv.
function tmdbEpisodeMeta(d, meta) {
  if (meta.type === "movie") return meta;
  var before = 0;
  (d.seasons || []).forEach(function (s) {
    if (s.season_number > 0 && s.season_number < meta.season) before += s.episode_count || 0;
  });
  meta.absEpisode = before + meta.episode;
  return tmdbGet("/tv/" + d.id + "/season/" + meta.season + "/episode/" + meta.episode)
    .then(function (ep) {
      meta.episodeName = ep.name || "";
      return meta;
    })
    .catch(function () {
      return meta;
    });
}
