// src/postDraft.js
//
// 100% FREE pipeline:
// 1. Pull trending tech stories from THREE platforms (all free, no keys
//    needed): Hacker News, r/technology, and r/programming.
// 2. Ask Groq (free-tier LLM API, no credit card required) to pick whichever
//    topic shows the strongest cross-platform buzz (ideally appearing on
//    more than one source) and write ONE paragraph explaining it, sized to
//    fit X's free-tier character limit.
// 3. Send the draft to Telegram (your phone) for manual review + posting.
//
// Runs on a schedule via GitHub Actions — no server, no device of yours
// needs to be on, and no paid API is used anywhere in this pipeline.

const MAX_CHARS = 180; // tighter limit per user preference
const GROQ_MODEL = "openai/gpt-oss-120b"; // free tier on Groq as of writing

const GROQ_API_KEY = process.env.GROQ_API_KEY;
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;

// ---- Step 1a: Hacker News (free, no key) ----
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

// ---- Step 1b: Reddit (free, no key — public .json endpoints) ----
async function getRedditStories(subreddit) {
  const res = await fetch(
    `https://www.reddit.com/r/${subreddit}/top.json?t=day&limit=15`,
    {
      headers: {
        // Reddit's public JSON endpoints require a descriptive User-Agent
        // or they may rate-limit/reject the request.
        "User-Agent": "tech-trends-poster/1.0 (personal free bot)",
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

// ---- Step 1: combine all sources into one list ----
async function getTrendingStories() {
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

// ---- Step 2: ask Groq (free tier) to pick one + write the paragraph ----
async function generateDraft(stories) {
  if (!GROQ_API_KEY) {
    throw new Error("Missing GROQ_API_KEY environment variable");
  }

  const storyList = stories
    .map((s, i) => `${i + 1}. [${s.source}] ${s.title} (${s.url})`)
    .join("\n");

  const systemPrompt = `You are a tech trends writer for an X (Twitter) account.
You will be given a list of currently trending tech stories pulled from
several different platforms (Hacker News, r/technology, r/programming) —
each line is tagged with its source in brackets.

Your job:
- Look across the whole list for a topic that shows up on MORE THAN ONE
  platform, or that multiple differently-worded titles seem to be about —
  that cross-platform repetition is a strong signal of genuine, broad
  trending interest, and should be preferred over a topic that only
  appears once.
- If nothing clearly repeats across platforms, fall back to picking the
  single most genuinely interesting, tech-related story (AI, programming
  languages, software engineering, cybersecurity, gadgets, startups, big
  tech, open source, etc.), weighing score/engagement too.
- Write EXACTLY ONE paragraph (no headers, no bullet points, no hashtags, no
  emojis) explaining it: what happened and why it matters, in plain,
  accessible language for a general tech-interested audience.
- HARD LIMIT: the paragraph must be under ${MAX_CHARS} characters total. Count
  carefully. Trim ruthlessly.
- After the paragraph, on a new line, output the story title only, prefixed
  with "TOPIC:" (for internal tracking, won't be posted).
- Do not editorialize or add opinions. Stay factual and neutral.
- Do not just copy the headline — explain it in your own words.`;

  const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${GROQ_API_KEY}`,
    },
    body: JSON.stringify({
      model: GROQ_MODEL,
      messages: [
        { role: "system", content: systemPrompt },
        {
          role: "user",
          content: `Here are today's trending stories:\n\n${storyList}\n\nPick one and write the post.`,
        },
      ],
      temperature: 0.7,
      max_tokens: 1024, // gpt-oss models spend tokens "reasoning" before writing the answer
      reasoning_effort: "low", // keep the thinking phase short so more budget goes to the actual paragraph
    }),
  });

  if (!res.ok) {
    const errBody = await res.text();
    throw new Error(`Groq API error: ${res.status} ${errBody}`);
  }

  const data = await res.json();
  const fullText = data.choices?.[0]?.message?.content?.trim() || "";

  const topicMatch = fullText.match(/TOPIC:\s*(.+)$/im);
  const topic = topicMatch ? topicMatch[1].trim() : "Unknown";
  const paragraph = fullText.replace(/TOPIC:\s*.+$/im, "").trim();

  return { paragraph, topic };
}

// ---- Step 3: send to Telegram (free) ----
async function sendToTelegram(text) {
  if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) {
    throw new Error(
      "Missing TELEGRAM_BOT_TOKEN or TELEGRAM_CHAT_ID environment variables"
    );
  }

  const url = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`;

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: TELEGRAM_CHAT_ID,
      text,
      parse_mode: "Markdown",
    }),
  });

  if (!res.ok) {
    const errBody = await res.text();
    throw new Error(`Telegram send failed: ${res.status} ${errBody}`);
  }

  return res.json();
}

// ---- Main ----
async function main() {
  try {
    const stories = await getTrendingStories();
    if (!stories.length) {
      throw new Error("No trending stories found on Hacker News right now.");
    }

    const { paragraph, topic } = await generateDraft(stories);

    if (!paragraph) {
      throw new Error("Groq returned an empty draft — aborting send.");
    }

    const charCount = paragraph.length;
    const overLimit = charCount > MAX_CHARS;

    const message =
      `*New X draft* (${charCount} chars${overLimit ? " ⚠️ OVER LIMIT" : ""})\n\n` +
      `${paragraph}\n\n` +
      `— Copy the paragraph above and post it to X.`;

    await sendToTelegram(message);
    console.log(`Draft sent to Telegram. Topic: ${topic}. Chars: ${charCount}`);
  } catch (err) {
    console.error("Failed to generate/send draft:", err);
    process.exit(1);
  }
}

main();
