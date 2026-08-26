// src/sources.js
// Trend discovery: Hacker News + Reddit public JSON endpoints.
// Extracted unchanged (modulo structure) from the v1 monolith.

// ---- Hacker News (free, no key) ----
async function getHackerNewsStories() {
  const topIdsRes = await fetch(
    "https://hacker-news.firebaseio.com/v0/topstories.json"
  );
  const topIds = await topIdsRes.json();

  const top15 = topIds.slice(0, 15);
  const stories = await Promise.all(
    top15.map(async (id) => {
      const res = await fetch(
        `https://hacker-news.firebaseio.com/v0/item/${id}.json`
      );
      return res.json();
    })
  );

  return stories
    .filter((s) => s && s.title && s.url)
    .map((s) => ({
      title: s.title,
      url: s.url,
      score: s.score || 0,
      source: "Hacker News",
    }));
}

// ---- Reddit (free, no key — public .json endpoints) ----
async function getRedditStories(subreddit) {
  const res = await fetch(
    `https://www.reddit.com/r/${subreddit}/top.json?t=day&limit=15`,
    {
      headers: {
        "User-Agent": "tech-trends-poster/2.0 (personal free bot)",
      },
    }
  );

  if (!res.ok) {
    console.warn(`Reddit r/${subreddit} fetch failed: ${res.status} — skipping this source.`);
    return [];
  }

  const data = await res.json();
  const posts = data?.data?.children || [];

  return posts
    .filter((p) => p?.data?.title)
    .map((p) => ({
      title: p.data.title,
      url: p.data.url_overridden_by_dest || `https://reddit.com${p.data.permalink}`,
      score: p.data.score || 0,
      source: `r/${subreddit}`,
    }));
}

// ---- Combined ----
export async function getTrendingStories() {
  const [hn, tech, programming] = await Promise.all([
    getHackerNewsStories(),
    getRedditStories("technology"),
    getRedditStories("programming"),
  ]);

  const combined = [...hn, ...tech, ...programming];

  if (!combined.length) {
    throw new Error("All sources failed or returned nothing — check source APIs.");
  }

  return combined;
}
