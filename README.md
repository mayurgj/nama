# NAMA: Nuvio providers

Nuvio local-scraper providers for Indian-dub anime and movies:

| Provider | Site | Player host | Audio |
|---|---|---|---|
| AnimeSalt | animesalt.cx | ravok.buzz | HI • TA • TE • EN • JA |
| WatchAnimeWorld | watchanimeworld.one | play.zephyrix.org | HI • TA • TE • ML • BN • EN • JA |
| MultiMovies | current mirror from multimovies.wtf | 8 servers, see below | whatever each server has |

Each server gives two streams, **1080p** and **720p**. Each stream carries **every audio language**, which you switch in Nuvio's player.

### MultiMovies
The domain rotates, so each lookup reads the current mirror from the "Visit MultiMovies" button on
`multimovies.wtf` (falling back to `m1.multimovies.courses`). A title is found with the site's `/api/search`,
and the watch page's `watchConfig.initialServers` lists the servers. Each server has its own extractor:

| Server | How it resolves |
|---|---|
| Vidrift | `orionStreams` in the embed page (movies), or `/api/source` (tv) |
| VidBolt | `/api/resolve` |
| Filmu | sealed stream list in the Next.js payload (vidly.pro) |
| Nexus | server-action token + sha256 proof of work, then `/api/extract` |
| GD mirror / IQSmart, Filesforever Mirror | iqsmart `embedhelper2` → StreamHG / EarnVids (packed JWPlayer) |
| Cineverse | modiplay switcher → EarnVids / StreamHG |
| VIDOUT | its GitHub catalogue (titles not listed there have no VIDOUT stream) |

Servers that list each dub as a separate source (Vidrift, VidBolt, Filmu, Nexus) are merged: one video plus
every dub as an audio track, keeping only dubs whose length matches (another cut would drift). Each server gives
one stream per resolution (1080p, 720p) with all its audio languages, and no per-language streams.

## Sorting
Streams are sorted by the keys in `NAMA_SORT` (`src/common/format.js`), most important first:

| Key | Order |
|---|---|
| `resolution` | 1080p before 720p |
| `multi` | more audio languages first, so multi-audio comes before single-language |
| `language` | streams that have a language earlier in `NAMA_LANG_ORDER` first (HI, TA, TE, ML, BN, KN, MR, EN, JA, KO, ZH) |

The default is `["resolution", "multi", "language"]`. Reorder or drop keys, or reorder `NAMA_LANG_ORDER`
(for example Tamil first), then rebuild. Ties keep the provider's own order.

## Install in Nuvio
Settings → Plugins (Local Scrapers) → add repository:

```
https://raw.githubusercontent.com/<your-github-user>/nama/main/manifest.json
```

## Build
Nuvio loads `providers/*.js` as-is, so commit them after every build.

```bash
NAMA_TMDB_KEY=<your tmdb v3 key> python3 build.py
```

Get a free TMDB v3 key at https://www.themoviedb.org/settings/api.

## Test (needs Node 18+)
```bash
node test/run.js
```

TMDB is mocked unless `NAMA_TMDB_KEY` is set. The site scraping and playlists are always live.

## How it works
1. TMDB id → title, year, poster, and absolute episode number.
2. The site search picks the best `/series/` or `/movies/` page. Scoring uses the title, type, and the TMDB poster.
3. tv: `/episode/<slug>-SxE/`. If the site's seasons don't match TMDB, it falls back to the absolute episode number.
4. FirePlayer `getVideo` returns the HLS master. For each resolution, the provider builds a small playlist with only that video variant plus every `EXT-X-MEDIA` audio track, and hands it to the player as a `data:` URI.

If a player can't open `data:` playlists (possibly iOS), set `PER_RES_MODE = "master"` in `src/common/fireplayer.js` and rebuild. You then get one auto-quality stream per server.

## Releasing an update
Bump `version` in `manifest.json`, rebuild, and push. raw.githubusercontent caches for about 5 minutes.
