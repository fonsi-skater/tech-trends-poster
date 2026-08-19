// src/postDraft.js
//
// 100% FREE pipeline:
// 1. Pull trending tech stories from Hacker News (free, no API key needed)
// 2. Ask Groq (free-tier LLM API, no credit card required) to write ONE
//    paragraph explaining the most interesting one, sized to fit X's
//    free-tier character limit.
// 3. Send the draft to Telegram (your phone) for manual review + posting.
//
// Runs on a schedule via GitHub Actions — no server, no device of yours
// needs to be on, and no paid API is used anywhere in this pipeline.

const MAX_CHARS = 190; // leaves headroom under X's 280-char free-tier limit
const GROQ_MODEL = "openai/gpt-oss-120b"; // free tier on Groq as of writing

const GROQ_API_KEY = process.env.GROQ_API_KEY;
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;

// ---- Step 1: pull trending stories from Hacker News (free, no key) ----
async function getTrendingStories() {
  const topIdsRes = await fetch(
    "https://hacker-news.firebaseio.com/v0/topstories.json"
  );
  const topIds = await topIdsRes.json();

  // Grab the top 15 stories' details, filter for tech relevance
  const top15 = topIds.slice(0, 15);
  const stories = await Promise.all(
    top15.map(async (id) => {
      const res = await fetch(
        `https://hacker-news.firebaseio.com/v0/item/${id}.json`
      );
      return res.json();
    })
  );

  // Keep stories with a title and a link (skip Ask HN/job posts with no url)
  return stories
    .filter((s) => s && s.title && s.url)
    .map((s) => ({ title: s.title, url: s.url, score: s.score || 0 }));
}

// ---- Step 2: ask Groq (free tier) to pick one + write the paragraph ----
async function generateDraft(stories) {
  if (!GROQ_API_KEY) {
    throw new Error("Missing GROQ_API_KEY environment variable");
  }

  const storyList = stories
    .map((s, i) => `${i + 1}. ${s.title} (${s.url})`)
    .join("\n");

  const systemPrompt = `You are a tech trends writer for an X (Twitter) account.
You will be given a list of currently trending tech stories from Hacker News.

Your job:
- Pick the ONE most genuinely interesting, tech-related story (AI, programming
  languages, software engineering, cybersecurity, gadgets, startups, big tech,
  open source, etc.)
- Write EXACTLY ONE paragraph (no headers, no bullet points, no hashtags, no
  emojis) explaining it: what happened and why it matters, in plain, accessible
  language for a general tech-interested audience.
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
      max_tokens: 1024,
      reasoning_effort: "low",
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
