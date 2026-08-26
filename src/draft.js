// src/draft.js
// Groq-powered draft generation, now with JSON mode so one call returns the
// paragraph, the topic tag, AND a Fonsi-Sniffer meme spec.

import { normalizeMemeSpec } from "./meme.js";

const MAX_CHARS = 180;
const GROQ_MODEL = "openai/gpt-oss-120b";

const GROQ_API_KEY = process.env.GROQ_API_KEY;

export async function generateDraft(stories, recentTopics, memeSlugs) {
  if (!GROQ_API_KEY) {
    throw new Error("Missing GROQ_API_KEY environment variable");
  }

  const storyList = stories
    .map((s, i) => `${i + 1}. [${s.source}] ${s.title} (${s.url})`)
    .join("\n");

  const recentList = recentTopics.length
    ? recentTopics.slice(-12).map((t) => `- ${t.topic}`).join("\n")
    : "(none yet)";

  const slugSample = memeSlugs.length
    ? memeSlugs.slice(0, 80).join(", ")
    : "drake, buzz, two-buttons, distracted-boyfriend";

  const systemPrompt = `You are a tech trends writer for an X (Twitter) account who also makes memes.
You will be given trending tech stories from several platforms (Hacker News,
r/technology, r/programming), each line tagged with its source.

Topics already posted recently — DO NOT pick any of these again:
${recentList}

Your job — respond ONLY with a JSON object (no markdown fences, no extra text):
{
  "paragraph": string,
  "topic": string,
  "meme": { "template": string, "top_text": string, "bottom_text": string }
}

Rules for "paragraph":
- Look across the whole list for a topic appearing on MORE THAN ONE platform —
  that cross-platform repetition signals broad interest and is preferred.
  Skip anything on the already-posted list. If nothing repeats, pick the most
  genuinely interesting tech story, weighing engagement too.
- EXACTLY ONE paragraph: what happened and why it matters, plain accessible
  language, no headers/bullets/hashtags/emojis/opinions. Don't copy the headline.
- HARD LIMIT: under ${MAX_CHARS} characters total. Count carefully.

Rules for "topic":
- The story title only. Won't be posted; used for repeat-tracking.

Rules for "meme" (this becomes a Fonsi-Sniffer branded meme link):
- "template" MUST be one of these exact slugs: ${slugSample}
- Pick whichever template's format best fits the story's joke angle.
- top_text / bottom_text: punchy internet-humor captions about the story,
  each under 60 characters, no slashes or underscores, no hashtags.`;

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
          content: `Here are today's trending stories:\n\n${storyList}\n\nPick one and write the post + meme.`,
        },
      ],
      temperature: 0.7,
      max_tokens: 1500,
      reasoning_effort: "low",
      response_format: { type: "json_object" },
    }),
  });

  if (!res.ok) {
    const errBody = await res.text();
    throw new Error(`Groq API error: ${res.status} ${errBody}`);
  }

  const data = await res.json();
  const raw = data.choices?.[0]?.message?.content?.trim() || "";
  if (!raw) throw new Error("Groq returned an empty response");

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    // Model occasionally wraps JSON in fences despite instructions — extract it.
    const match = raw.match(/\{[\s\S]*\}/);
    if (!match) throw new Error(`Groq returned non-JSON content: ${raw.slice(0, 200)}`);
    parsed = JSON.parse(match[0]);
  }

  const paragraph = String(parsed.paragraph || "").trim();
  const topic = String(parsed.topic || "Unknown").trim();
  const meme = normalizeMemeSpec(parsed.meme, memeSlugs);

  if (!paragraph) throw new Error("Groq returned an empty paragraph");

  return { paragraph, topic, meme };
}

// Standalone meme regeneration for the /meme command.
export async function generateMemeOnly(storyHint, memeSlugs) {
  if (!GROQ_API_KEY) {
    throw new Error("Missing GROQ_API_KEY environment variable");
  }

  const slugSample = memeSlugs.length
    ? memeSlugs.slice(0, 80).join(", ")
    : "drake, buzz, two-buttons";

  const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${GROQ_API_KEY}`,
    },
    body: JSON.stringify({
      model: GROQ_MODEL,
      messages: [
        {
          role: "system",
          content: `You write Fonsi-Sniffer memes about tech news. Respond ONLY with JSON:
{ "template": string, "top_text": string, "bottom_text": string }
"template" MUST be one of: ${slugSample}
Captions: punchy internet humor, each under 60 chars, no slashes/underscores/hashtags.`,
        },
        { role: "user", content: `Story: ${storyHint}` },
      ],
      temperature: 0.9,
      max_tokens: 800,
      reasoning_effort: "low",
      response_format: { type: "json_object" },
    }),
  });

  if (!res.ok) {
    throw new Error(`Groq API error: ${res.status} ${await res.text()}`);
  }

  const data = await res.json();
  const raw = data.choices?.[0]?.message?.content?.trim() || "";
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    const match = raw.match(/\{[\s\S]*\}/);
    if (!match) throw new Error("Groq returned non-JSON meme spec");
    parsed = JSON.parse(match[0]);
  }

  const meme = normalizeMemeSpec(parsed, memeSlugs);
  if (!meme || (!meme.top_text && !meme.bottom_text)) {
    throw new Error("Groq returned an empty meme spec");
  }
  return meme;
}

export { MAX_CHARS };
