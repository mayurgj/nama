# NAMA: Nuvio providers

Nuvio local-scraper providers for Indian-dub anime:

| Provider | Site | Player host | Audio |
|---|---|---|---|
| AnimeSalt | animesalt.cx | ravok.buzz | HI • TA • TE • EN • JA |
| WatchAnimeWorld | watchanimeworld.one | play.zephyrix.org | HI • TA • TE • ML • BN • EN • JA |

Each server gives two streams, **1080p** and **720p**. Each stream carries **every audio language**, which you switch in Nuvio's player.

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
