# Nama

> Named after the Greek **νᾶμα** (*nāma*) — "stream, running water."

A collection of high-performance local scrapers and streaming providers for the **[Nuvio](https://nuvioapp.org)** streaming application (Mobile & Android TV).

Nama acts as a plugin bundle where multiple providers are hosted, maintained, and loaded into Nuvio via a single manifest URL — similar to **[All-in-One-Nuvio](https://github.com/NuvioPlugin/All-in-One-Nuvio)**.

---

## Included Providers

| Provider | Content | Audio / Languages | Formats | Status | File |
|---|---|---|---|---|---|
| **AnimeSalt** (`https://animesalt.cx/`) | Movies, TV Series & Anime | Hindi, Tamil, Telugu, English, Japanese | HLS (`m3u8`), `mp4` | Active | [`providers/animesalt.js`](providers/animesalt.js) |
| **MultiMovies** (`https://multimovies.wtf/`) | Movies & Series | Original, Hindi, Tamil, Telugu, Kannada | HLS (`m3u8`) | Active | [`providers/multimovies.js`](providers/multimovies.js) |

---

## Installation in Nuvio

1. Open the **Nuvio** app on your Mobile device or Android TV.
2. Navigate to **Settings** → **Content & Discovery** → **Plugins** (or **Local Scrapers**).
3. Tap **"Add Plugin"** or **"+"**.
4. Paste the raw `manifest.json` link:
   ```text
   https://raw.githubusercontent.com/mayurgj/nama/main/manifest.json
   ```
5. Tap **Save / Confirm** and toggle on your desired providers.

---

## Stream Shape

Every provider returns streams in a single, structured shape that Nuvio's display
template renders directly — no provider-specific `name` string. The schema:

```js
{
  url: string,                 // required — direct playable URL
  provider: string,            // required — e.g. "animesalt" | "multimovies"
  type: "m3u8" | "mp4" | "mkv" | "mpd",
  resolution: "2160p" | "1440p" | "1080p" | "720p" | "480p" | "360p" | null,
  quality: string | null,      // "BluRay Remux" | "BluRay" | "WEB-DL" | "WEBRip" |
                               // "HC HDRip" | "HDRip" | "DVDRip" | "HDTV" |
                               // "CAMRip" | "CAM" | "TS" | null
  encode: string | null,       // "x265" | "x264" | "AV1" | "VP9" | null
  visualTags: string[],        // subset of ["DV","HDR10+","HDR10","HDR","HLG"]
  audioTags: string[],         // ["Atmos","TrueHD","DTS-HD MA","DTS-HD","DTS-X",
                               //  "DTS","DD+","DD","AAC","FLAC","Opus","MP3"]
  audioChannels: string[],     // ["7.1","5.1","2.1","2.0"]
  languages: string[],         // ISO-639-1 codes: ["en","hi","ta","te","ja","multi"]
  releaseGroup: string | null,
  size: number | null,         // bytes
  bitrate: number | null,      // bits per second
  seasonEpisode: [string,string] | null, // ["S01","E05"] for TV; null for movies
  title: string | null,        // raw release/filename text (what parsers scanned)
  headers: Record<string,string> | null,
  subtitles: Array<{ lang: string, url: string }>
}
```

### Using `formatStream` in a new extractor

Every extractor returns `formatStream({...})` output. Pass whatever hints you
already know; the formatter parses the rest out of `title`. Explicit args
always win over parsed values.

```javascript
const { formatStream } = require("../../shared/formatter");

return formatStream({
  url: "https://cdn.example/hls/abc/master.m3u8?token=t",
  provider: "myprovider",
  type: "m3u8",              // optional — inferred from URL extension
  title: "Jailer.2.2026.1080p.WEB-DL.DDP5.1.H.265.Hindi-Tamil-RARBG.mkv",
  // explicit overrides (any of these win over the parsers):
  resolution: "1080p",
  languages: ["hi", "ta"],
  // delivery metadata
  headers: { "Referer": "https://embed.example/" },
  subtitles: []
});
// → { url, provider, type:"m3u8", resolution:"1080p", quality:"WEB-DL",
//     encode:"x265", audioTags:["DD+"], audioChannels:["5.1"],
//     languages:["hi","ta"], releaseGroup:"RARBG", ... }
```

---

## Adding New Providers

1. **Create the source modules** under `src/providers/<provider_id>/`.
   The minimum shape is an `index.js` that exports `getStreams`:
   ```javascript
   // src/providers/myprovider/index.js
   const { formatStream } = require("../../shared/formatter");
   const { RESOLUTION_ORDER } = require("../../shared/constants");

   async function getStreams(tmdbId, mediaType = "movie", seasonNum = 1, episodeNum = 1) {
     // 1. resolve the embed, 2. extract raw URLs, 3. return formatStream(...)
     return [
       formatStream({
         url: "https://.../stream.m3u8",
         provider: "myprovider",
         title: "Release.Title.2026.1080p.WEB-DL.x265",
         headers: { "Referer": "..." }
       })
     ].sort((a, b) =>
       (RESOLUTION_ORDER[b.resolution] ?? -1) - (RESOLUTION_ORDER[a.resolution] ?? -1)
     );
   }

   module.exports = { getStreams };
   ```

2. **Register the bundle in `build.js`**. Add a `bundleProvider({...})` call
   listing the source modules (shared modules go first):
   ```javascript
   bundleProvider({
     id: "myprovider",
     sources: [
       ...SHARED,
       "providers/myprovider/index.js"
     ],
     outFile: path.join(DIST_DIR, "myprovider.js"),
     header: "/** My Provider Nuvio Scraper */"
   });
   ```

3. **Register the plugin in `manifest.json`**:
   ```json
   {
     "id": "myprovider",
     "name": "My Provider",
     "description": "Short description & language details",
     "version": "1.0.0",
     "author": "mayurgj",
     "supportedTypes": ["movie", "tv"],
     "filename": "providers/myprovider.js",
     "enabled": true,
     "formats": ["m3u8", "mp4"],
     "logo": "https://www.google.com/s2/favicons?domain=example.com&sz=128",
     "contentLanguage": ["en"]
   }
   ```

4. Run `npm run build && npm test`, commit the generated `providers/myprovider.js`
   and the manifest/source changes. Nuvio will pick up the new provider on its
   next plugin refresh.

---

## Repository Structure

```
nama/
├── manifest.json              # Nuvio repository & scraper registry
├── package.json               # Node.js dependencies and scripts
├── build.js                   # Per-provider bundler
├── providers/                 # Production-ready scraper bundles
│   ├── animesalt.js
│   └── multimovies.js
├── src/
│   ├── shared/                # Cross-provider helpers
│   │   ├── constants.js       # Headers, HLS parsing, resolution order, utils
│   │   ├── formatter.js       # formatStream() + release-title parsers
│   │   └── tmdb.js            # Shared TMDB resolver
│   └── providers/
│       ├── animesalt/
│       │   ├── constants.js
│       │   ├── search.js
│       │   ├── episodes.js
│       │   ├── extractors/    # awsstream, megaplay, streamwish, multilang
│       │   └── index.js
│       └── multimovies/
│           ├── constants.js
│           ├── search.js
│           ├── extractors/    # vidrift, vidout, cineverse, vidbolt, filmu
│           └── index.js
└── test/
    ├── formatter.test.js      # Table-driven parser unit tests
    └── test.js                # Provider end-to-end tests (mocked fetch)
```

---

## Development & Testing

```bash
# Install dependencies
npm install

# Run the full test suite (offline — mocked fetch + unit tests)
npm test

# Run the full suite including network-backed TMDB / scrape tests
node test/test.js --network

# Rebuild provider bundles
npm run build
```

Set `globalThis.NUVIO_DEBUG = true` at runtime to surface internal warnings from the scrapers.

---

## License
MIT © mayurgj
