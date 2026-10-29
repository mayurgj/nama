const { TMDB_BASE_URL, DEFAULT_TMDB_KEY, HEADERS, timeoutSignal, warn } = require("./constants");

async function fetchTmdbDetails(tmdbId, mediaType, userApiKey) {
  const apiKey = userApiKey || DEFAULT_TMDB_KEY;
  let resolvedId = tmdbId;

  if (typeof tmdbId === "string" && tmdbId.trim().toLowerCase().startsWith("tt")) {
    try {
      const findUrl = `${TMDB_BASE_URL}/find/${tmdbId.trim()}?api_key=${apiKey}&external_source=imdb_id`;
      const findRes = await fetch(findUrl, { headers: HEADERS, signal: timeoutSignal(8000) });
      if (findRes && findRes.ok) {
        const findData = await findRes.json();
        const results = mediaType === "tv" ? findData.tv_results : findData.movie_results;
        if (results && results.length > 0) {
          resolvedId = results[0].id;
        }
      }
    } catch (e) {
      warn("tmdb:find", e);
    }
  }

  try {
    const endpoint = mediaType === "movie" ? "movie" : "tv";
    const url = `${TMDB_BASE_URL}/${endpoint}/${resolvedId}?api_key=${apiKey}&append_to_response=alternative_titles,external_ids`;
    const res = await fetch(url, { headers: HEADERS, signal: timeoutSignal(8000) });
    if (!res || !res.ok) return null;
    const data = await res.json();

    const title = mediaType === "movie"
      ? data.title || data.original_title
      : data.name || data.original_name;
    const originalTitle = mediaType === "movie" ? data.original_title : data.original_name;

    const releaseDate = data.release_date || data.first_air_date || "";
    const year = parseInt(releaseDate.substring(0, 4), 10) || null;

    const aliases = new Set();
    if (originalTitle && originalTitle !== title) aliases.add(originalTitle);

    const altList = (data.alternative_titles && (data.alternative_titles.titles || data.alternative_titles.results)) || [];
    for (const alt of altList) {
      const altTitle = alt.title || alt.name;
      if (altTitle && altTitle.trim()) aliases.add(altTitle.trim());
    }

    return {
      id: resolvedId,
      title: (title || "").trim(),
      originalTitle: (originalTitle || "").trim(),
      aliases: Array.from(aliases),
      year,
      imdbId: (data.external_ids && data.external_ids.imdb_id) || null
    };
  } catch (e) {
    warn("tmdb:details", e);
    return null;
  }
}

module.exports = {
  fetchTmdbDetails
};
