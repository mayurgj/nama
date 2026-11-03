# NAMA development notes

## Streams
Each server gives two streams, **1080p** and **720p**. Each stream carries **every audio language**, which you switch in Nuvio's player.

## Stream card
Built by `namaFormatStream` in `src/common/format.js`:

```
1080p | Multi Audio                 name (single language: "1080p | Hindi")
🎬 Naruto | S01 E05                 title (cut at NAMA_TITLE_MAX = 32 chars); movies: title only
🎧 HIN • TAM • TEL • ENG • JPN      multi-audio streams only
📺 HLS • AVC • AAC 2.0              codecs from the variant's CODECS, channels from the audio CHANNELS
🌐 AnimeSalt | ravok.buzz           provider | stream server
```

Nuvio shows `name` in bold and the `size` field as the grey lines (`title` is not shown).
Nuvio has no badges of its own: users import regex badge packs that scan the name and description.
The wording above is picked so those packs match: `1080p`/`720p`, `Multi Audio`, full language
names, ISO 639-2 codes (`HIN`, `ENG`, `JPN`), `AVC`/`HEVC`, `AAC`, `2.0`/`5.1`. Keep that in mind
when changing the text. `node test/run.js` checks the resolution and multi-audio wording.

## MultiMovies
The domain rotates, so each lookup reads the current mirror from the "Visit MultiMovies" button on
`multimovies.wtf` (falling back to `m1.multimovies.courses`). A title is found with the site's `/api/search`,
and the watch page's `watchConfig.initialServers` lists the servers. Each server has its own extractor. GD mirror, Cineverse and Filesforever Mirror are not used: their StreamHG / EarnVids segments sit on TikTok's image CDN disguised as PNGs (a 70-byte image header, then MPEG-TS), which app players reject. `mmDisguised` also probes the first video segment of every remaining server and drops it when it is an image:

| Server | How it resolves |
|---|---|
| Vidrift | `orionStreams` in the embed page (movies), or `/api/source` (tv) |
| VidBolt | `/api/resolve` |
| Filmu | sealed stream list in the Next.js payload (vidly.pro) |
| Nexus | server-action token + sha256 proof of work, then `/api/extract` |
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
