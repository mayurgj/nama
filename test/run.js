// Live test harness: node test/run.js [provider...]
// TMDB is mocked unless NAMA_TMDB_KEY is set (the site scraping is always live).
const path = require("path");

const CASES = [
  // Naruto: TMDB has 1 season of 220, the sites split it into 5 (absolute fallback).
  { label: "Naruto S01E001", id: "46260", type: "tv", s: 1, e: 1 },
  { label: "Naruto S01E058", id: "46260", type: "tv", s: 1, e: 58 },
  { label: "Demon Slayer: Infinity Castle", id: "1311031", type: "movie" },
  { label: "Your Name", id: "372058", type: "movie" },
  // Korean drama with Indian dubs; TMDB's "Dead-End Job" is "Dead End Job" on MultiMovies.
  { label: "Dead-End Job S01E01", id: "289517", type: "tv", s: 1, e: 1, only: ["multimovies"] },
];

const MOCK = {
  "/tv/46260": { id: 46260, original_language: "ja", name: "Naruto", original_name: "ナルト", first_air_date: "2002-10-03", seasons: [{ season_number: 1, episode_count: 220 }] },
  "/movie/1311031": { id: 1311031, original_language: "ja", title: "Demon Slayer: Kimetsu no Yaiba Infinity Castle", original_title: "劇場版「鬼滅の刃」無限城編 第一章 猗窩座再来", release_date: "2025-07-18" },
  "/tv/289517": { id: 289517, original_language: "ko", name: "Dead-End Job", original_name: "꿀알바", first_air_date: "2026-01-01", poster_path: "/vrDDqk9PAkIs0PQAbW5G0yhPVS3.jpg", seasons: [{ season_number: 1, episode_count: 12 }] },
  "/movie/372058": { id: 372058, original_language: "ja", title: "Your Name.", original_title: "君の名は。", release_date: "2016-08-26", poster_path: "/q719jXXEzOoYaps6babgKnONONX.jpg" },
};

const realFetch = global.fetch;
if (!process.env.NAMA_TMDB_KEY) {
  global.fetch = (url, opts) => {
    const m = /api\.(?:themoviedb|tmdb)\.org\/3([^?]+)/.exec(url);
    if (!m) return realFetch(url, opts);
    const body = MOCK[m[1]];
    return Promise.resolve({ ok: !!body, status: body ? 200 : 404, text: () => Promise.resolve(JSON.stringify(body || {})) });
  };
}

function decodePlaylist(url) {
  const b64 = url.split("base64,")[1];
  return Buffer.from(b64, "base64").toString("utf8");
}

async function checkStream(st) {
  const problems = [];
  if (st.type === "mp4") {
    const r = await realFetch(st.url, { headers: Object.assign({ Range: "bytes=0-1023" }, st.headers) });
    if (r.status !== 200 && r.status !== 206) problems.push("mp4 HTTP " + r.status);
    return problems;
  }
  if (!st.url.startsWith("data:")) {
    const r = await realFetch(st.url, { headers: st.headers });
    const t = await r.text();
    if (!t.startsWith("#EXTM3U")) problems.push("master is not m3u8");
    return problems;
  }
  const pl = decodePlaylist(st.url);
  const infs = pl.split("\n").filter((l) => l.startsWith("#EXT-X-STREAM-INF"));
  const audios = pl.split("\n").filter((l) => l.includes("TYPE=AUDIO"));
  if (!pl.startsWith("#EXTM3U")) problems.push("no #EXTM3U");
  if (infs.length !== 1) problems.push(infs.length + " STREAM-INF lines");
  if (!infs[0] || !infs[0].includes("x" + parseInt(/\| (\d+)p/.exec(st.name)[1]))) problems.push("resolution mismatch");
  // Muxed audio (no AUDIO group on the variant) is fine too.
  if (!audios.length && infs[0] && infs[0].includes("AUDIO=")) problems.push("no audio renditions");
  const uris = pl.split("\n").filter((l) => l && !l.startsWith("#")).concat(audios.slice(0, 1).map((l) => /URI="([^"]+)"/.exec(l)[1]));
  for (const u of uris) {
    if (!/^https?:\/\//.test(u)) { problems.push("relative uri " + u); continue; }
    const r = await realFetch(u, { headers: st.headers });
    const t = await r.text();
    if (!r.ok || !t.startsWith("#EXTM3U")) problems.push("HTTP " + r.status + " for " + u.slice(0, 60));
  }
  return problems;
}

(async () => {
  const providers = process.argv.slice(2).length ? process.argv.slice(2) : ["animesalt", "watchanimeworld", "multimovies"];
  let failed = 0;
  for (const p of providers) {
    const { getStreams } = require(path.join(__dirname, "..", "providers", p + ".js"));
    for (const c of CASES) {
      if (c.only && !c.only.includes(p)) continue;
      const t0 = Date.now();
      const streams = await getStreams(c.id, c.type, c.s, c.e);
      console.log(`\n=== ${p} | ${c.label} | ${streams.length} streams | ${Date.now() - t0}ms`);
      if (!streams.length) failed++;
      for (const st of streams) {
        console.log(`${st.name}\n${st.size}`);
        const problems = await checkStream(st);
        console.log(problems.length ? "  ✗ " + problems.join("; ") : "  ✓ playlist OK");
        if (problems.length) failed++;
      }
    }
  }
  console.log(failed ? `\n${failed} problem(s)` : "\nall OK");
  process.exit(failed ? 1 : 0);
})();
