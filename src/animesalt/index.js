// AnimeSalt (animesalt.cx): Hindi/Tamil/Telugu/English/Japanese dubs via ravok.buzz.
var SITE = { name: "AnimeSalt", base: "https://animesalt.cx" };

function getStreams(tmdbId, mediaType, season, episode) {
  return toroGetStreams(SITE, tmdbId, mediaType, season, episode);
}
