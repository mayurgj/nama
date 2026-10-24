# Nama

> Named after the Greek **νᾶμα** (*nāma*) — "stream, running water."

A collection of high-performance local scrapers and streaming providers for the **[Nuvio](https://nuvioapp.org)** streaming application (Mobile & Android TV).

Nama acts as a plugin bundle where multiple providers are hosted, maintained, and loaded into Nuvio via a single manifest URL — similar to **[All-in-One-Nuvio](https://github.com/NuvioPlugin/All-in-One-Nuvio)**.

---

## Included Providers

| Provider | Content | Audio / Languages | Formats | Status | File |
|---|---|---|---|---|---|
| **AnimeSalt** (`https://animesalt.cx/`) | Movies, TV Series & Anime | Hindi, Tamil, Telugu, English, Japanese | HLS (`m3u8`), `mp4` | Active | [`providers/animesalt.js`](providers/animesalt.js) |

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

## Adding New Providers

1. **Create the scraper script**
   Place your scraper file in `providers/<provider_id>.js`. Each provider must implement the standard Nuvio CommonJS interface:
   ```javascript
   async function getStreams(tmdbId, mediaType = "movie", seasonNum = 1, episodeNum = 1) {
     return [
       {
         name: "Provider Name",
         title: "Media Title",
         url: "https://.../stream.m3u8",
         quality: "1080p",
         headers: { "Referer": "..." },
         subtitles: [],
         provider: "provider_id",
         type: "m3u8"
       }
     ];
   }

   module.exports = { getStreams };
   ```

2. **Register in `manifest.json`**
   Add a new entry to the `scrapers` array:
   ```json
   {
     "id": "new-provider",
     "name": "New Provider Name",
     "description": "Provider description and language details",
     "version": "1.0.0",
     "author": "mayurgj",
     "supportedTypes": ["movie", "tv"],
     "filename": "providers/new-provider.js",
     "enabled": true,
     "formats": ["m3u8", "mp4"],
     "logo": "https://www.google.com/s2/favicons?domain=example.com&sz=128",
     "contentLanguage": ["en"]
   }
   ```

3. Commit and push the changes. Nuvio will pick up the new provider when it refreshes plugins.

---

## Repository Structure

```
nama/
├── manifest.json              # Nuvio repository & scraper registry
├── package.json               # Node.js dependencies and scripts
├── build.js                   # Bundler for source modules
├── providers/                 # Production-ready scraper bundles
│   └── animesalt.js
├── src/                       # Modular source code
│   ├── constants.js           # Shared utilities, headers, unpacker, helpers
│   ├── tmdb.js                # TMDB resolver
│   ├── search.js              # AnimeSalt search (direct + AJAX fallback)
│   ├── episodes.js            # Season / episode resolver
│   ├── extractors/            # Host embed extractors
│   │   ├── awsstream.js
│   │   ├── megaplay.js
│   │   ├── streamwish.js
│   │   ├── abyss.js
│   │   └── multilang.js
│   └── index.js               # Scraper orchestrator
└── test/
    └── test.js                # Automated test suite
```

---

## Development & Testing

```bash
# Install dependencies
npm install

# Run the test suite (offline — mocked fetch + unit tests)
npm test

# Run the full suite including network-backed TMDB / scrape tests
node test/test.js --network

# Rebuild provider bundles
npm run build
```

Set `globalThis.NUVIO_DEBUG = true` at runtime to surface internal warnings from the scraper.

---

## License
MIT © mayurgj
