const cheerio = require("cheerio-without-node-native");
const { HEADERS, joinUrl, warn } = require("../../shared/constants");
const { MAIN_URL } = require("./constants");

async function resolveEpisodeUrl(seriesUrl, seasonNum, episodeNum, showTitle) {
  try {
    const res = await fetch(seriesUrl, { headers: HEADERS });
    if (!res.ok) return null;
    const html = await res.text();
    const $ = cheerio.load(html);

    let seasonBtn = $(`div.season-buttons a[data-season="${seasonNum}"]`);
    if (seasonBtn.length === 0) {
      seasonBtn = $(`a[data-season="${seasonNum}"]`);
    }

    let postId = seasonBtn.length ? seasonBtn.attr("data-post") : null;
    if (!postId) {
      const anyBtn = $("div.season-buttons a[data-post]").first();
      if (anyBtn.length) postId = anyBtn.attr("data-post");
    }

    const dataSeason = seasonNum;

    if (postId) {
      const epRes = await fetch(`${MAIN_URL}/wp-admin/admin-ajax.php`, {
        method: "POST",
        headers: {
          ...HEADERS,
          "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
          "X-Requested-With": "XMLHttpRequest",
          "Referer": seriesUrl
        },
        body: `action=action_select_season&season=${dataSeason}&post=${postId}`
      });

      if (epRes.ok) {
        const epHtml = await epRes.text();
        const $ep = cheerio.load(epHtml);
        const epArticles = $ep("li article, article.post, li");
        let targetEp = null;

        const epStr = String(episodeNum);
        const epPad = episodeNum < 10 ? `0${episodeNum}` : epStr;
        const epPats = [
          { pat: `x${epStr}`, boundary: true },
          { pat: `x${epPad}`, boundary: true },
          { pat: `e${epStr}`, boundary: true },
          { pat: `e${epPad}`, boundary: true },
          { pat: `episode ${epStr}`, boundary: false },
          { pat: `episode ${epPad}`, boundary: false },
          { pat: `ep ${epStr}`, boundary: false },
          { pat: `ep ${epPad}`, boundary: false },
          { pat: `ep-${epStr}`, boundary: true },
          { pat: `-${epStr}/`, boundary: false },
          { pat: `-${epPad}/`, boundary: false }
        ];

        function patMatch(text, pattern, needBoundary) {
          const idx = text.indexOf(pattern);
          if (idx === -1) return false;
          if (!needBoundary) return true;
          const after = idx + pattern.length;
          if (after >= text.length) return true;
          const ch = text.charCodeAt(after);
          return ch < 48 || ch > 57;
        }

        epArticles.each((idx, el) => {
          const epText = $ep(el).find("h2.entry-title, .entry-title, .num-epi").text().toLowerCase();
          const href = $ep(el).find("a").first().attr("href");
          if (!href) return;
          const hrefLower = href.toLowerCase();
          for (const { pat, boundary } of epPats) {
            if (patMatch(epText, pat, boundary) || patMatch(hrefLower, pat, boundary)) {
              targetEp = href;
              return false;
            }
          }
        });

        if (!targetEp && epArticles.length >= episodeNum) {
          targetEp = $ep(epArticles[episodeNum - 1]).find("a").first().attr("href");
        }

        if (targetEp) return joinUrl(MAIN_URL, targetEp);
      }
    }

    const directLinks = [];
    $("a").each((_, el) => {
      const href = $(el).attr("href") || "";
      if (href.includes("/episode/") || href.includes("/episodes/")) {
        directLinks.push({ href, text: $(el).text() });
      }
    });

    const epStr2 = String(episodeNum);
    const epPad2 = episodeNum < 10 ? `0${episodeNum}` : epStr2;
    const directPats = [
      { pat: `x${epStr2}`, boundary: true },
      { pat: `x${epPad2}`, boundary: true },
      { pat: `episode-${epStr2}`, boundary: true },
      { pat: `episode-${epPad2}`, boundary: true },
      { pat: `episode ${epStr2}`, boundary: false },
      { pat: `episode ${epPad2}`, boundary: false },
      { pat: `ep-${epStr2}`, boundary: true },
      { pat: `ep-${epPad2}`, boundary: true }
    ];

    function patMatch2(text, pattern, needBoundary) {
      const idx = text.indexOf(pattern);
      if (idx === -1) return false;
      if (!needBoundary) return true;
      const after = idx + pattern.length;
      if (after >= text.length) return true;
      const ch = text.charCodeAt(after);
      return ch < 48 || ch > 57;
    }

    for (const item of directLinks) {
      const lower = `${item.href} ${item.text}`.toLowerCase();
      for (const { pat, boundary } of directPats) {
        if (patMatch2(lower, pat, boundary)) {
          return joinUrl(MAIN_URL, item.href);
        }
      }
    }

    if (directLinks.length >= episodeNum) {
      return joinUrl(MAIN_URL, directLinks[episodeNum - 1].href);
    }

    return null;
  } catch (e) {
    warn("episodes:resolve", e);
    return null;
  }
}

module.exports = {
  resolveEpisodeUrl
};
