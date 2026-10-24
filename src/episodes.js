const cheerio = require("cheerio-without-node-native");
const { MAIN_URL, HEADERS, joinUrl, warn } = require("./constants");

/**
 * Resolve a specific episode page URL from a series landing page.
 * @param {string} seriesUrl
 * @param {number} seasonNum
 * @param {number} episodeNum
 * @param {string} showTitle
 * @returns {Promise<string|null>}
 */
async function resolveEpisodeUrl(seriesUrl, seasonNum, episodeNum, showTitle) {
  try {
    const res = await fetch(seriesUrl, { headers: HEADERS });
    if (!res.ok) return null;
    const html = await res.text();
    const $ = cheerio.load(html);

    // 1. ToroFilm season buttons -> admin-ajax episode list
    let seasonBtn = $(`div.season-buttons a[data-season="${seasonNum}"]`);
    if (seasonBtn.length === 0) {
      seasonBtn = $(`a[data-season="${seasonNum}"]`);
    }
    if (seasonBtn.length === 0) {
      seasonBtn = $("div.season-buttons a").first();
    }

    const postId = seasonBtn.attr("data-post");
    const dataSeason = seasonBtn.attr("data-season") || seasonNum;

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

        const epPats = [
          `x${episodeNum}`,
          `x0${episodeNum}`,
          `e${episodeNum}`,
          `e0${episodeNum}`,
          `episode ${episodeNum}`,
          `episode 0${episodeNum}`,
          `ep ${episodeNum}`,
          `ep 0${episodeNum}`,
          `ep-${episodeNum}`,
          `-${episodeNum}/`
        ];

        epArticles.each((idx, el) => {
          const epText = $ep(el).find("h2.entry-title, .entry-title, .num-epi").text().toLowerCase();
          const href = $ep(el).find("a").first().attr("href");
          if (!href) return;
          for (const pat of epPats) {
            if (epText.includes(pat) || href.toLowerCase().includes(pat)) {
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

    // 2. Fallback: static episode links on the series page
    const directLinks = [];
    $("a").each((_, el) => {
      const href = $(el).attr("href") || "";
      if (href.includes("/episode/") || href.includes("/episodes/")) {
        directLinks.push({ href, text: $(el).text() });
      }
    });

    for (const item of directLinks) {
      const lower = `${item.href} ${item.text}`.toLowerCase();
      if (
        lower.includes(`x${episodeNum}`) ||
        lower.includes(`episode-${episodeNum}`) ||
        lower.includes(`episode ${episodeNum}`) ||
        lower.includes(`ep-${episodeNum}`)
      ) {
        return joinUrl(MAIN_URL, item.href);
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
