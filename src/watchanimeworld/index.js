// WatchAnimeWorld (watchanimeworld.one): Indian + EN/JA dubs via play.zephyrix.org.
var SITE = { name: "WatchAnimeWorld", base: "https://watchanimeworld.one" };

function getStreams(tmdbId, mediaType, season, episode) {
  return toroGetStreams(SITE, tmdbId, mediaType, season, episode);
}
