// src/server.js
// Entrypoint: always-on Telegram bot (long polling) + in-process scheduler
// + tiny HTTP health endpoint (keeps Render happy and lets a keep-alive
// ping prevent free-tier spin-down).
//
// Commands: /help /latest /draft /meme /location /sethome
// Scheduled: digest pipeline at 06:00 / 14:00 / 22:00 EAT (03/11/19 UTC).
//
// Env required: GROQ_API_KEY, TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID
// Env optional: DRY_RUN=1 (log instead of send), PORT, RUN_ON_START=1

import http from "http";
import cron from "node-cron";
import * as tg from "./telegram.js";
import { getTrendingStories } from "./sources.js";
import { generateDraft, generateMemeOnly } from "./draft.js";
import { getTemplateSlugs, buildMemeUrl } from "./meme.js";
import { readJson, writeJson } from "./store.js";
import {
  haversineKm,
  reverseGeocode,
  osrmRoute,
  gmapsDirectionsLink,
  osmDirectionsLink,
} from "./location.js";
import { renderRouteMap } from "./map.js";
import { MAX_CHARS } from "./draft.js";

const CHAT_ID = process.env.TELEGRAM_CHAT_ID;
const DRY_RUN = process.env.DRY_RUN === "1";

const RECENT_TOPICS_KEEP = 12;
let running = false;
const pendingSetHome = new Set();

// ---------- sends ----------

async function sendText(text, extra = {}) {
  if (DRY_RUN) {
    console.log("[dry-run] would send:", text.slice(0, 120).replace(/\n/g, " | "));
    return;
  }
  await tg.sendMessage(CHAT_ID, text, extra);
}

async function reply(chatId, text, extra = {}) {
  if (DRY_RUN) {
    console.log(`[dry-run] reply to ${chatId}:`, text.slice(0, 120));
    return;
  }
  await tg.sendMessage(chatId, text, extra);
}

// ---------- daily digest pipeline ----------

async function runPipeline(trigger = "schedule") {
  if (running) {
    console.log("Pipeline already running — skipping this trigger.");
    return;
  }
  running = true;
  try {
    console.log(`[${new Date().toISOString()}] pipeline triggered by ${trigger}`);

    const stories = await getTrendingStories();
    const recentTopics = await readJson("recent-topics.json", []);
    const slugs = await getTemplateSlugs();
    const { paragraph, topic, meme } = await generateDraft(stories, recentTopics, slugs);

    const memeUrl = meme ? buildMemeUrl(meme) : null;
    const overLimit = paragraph.length > MAX_CHARS;

    const message =
      `*New X draft* (${paragraph.length} chars${overLimit ? " ⚠️ OVER LIMIT" : ""})\n\n` +
      `${paragraph}\n\n` +
      (memeUrl ? `🔗 Fonsi-Sniffer link:\n${memeUrl}\n\n` : "") +
      `— Copy the paragraph (+ meme image) and post to X.`;

    await sendText(message);
    if (memeUrl && !DRY_RUN) {
      await tg.sendPhotoUrl(CHAT_ID, memeUrl, `Fonsi-Sniffer 🔥 ${topic}`).catch(
        (err) => console.error(`Meme photo failed (link still in message): ${err.message}`)
      );
    }

    const updated = [...recentTopics, { topic, date: new Date().toISOString() }];
    await writeJson("recent-topics.json", updated.slice(-RECENT_TOPICS_KEEP));
    await writeJson("last-draft.json", {
      paragraph,
      topic,
      storyHint: meme ? `${meme.top_text} ${meme.bottom_text}` : topic,
      memeUrl,
      date: new Date().toISOString(),
    });

    console.log(`[${trigger}] Draft sent. Topic: ${topic}. Chars: ${paragraph.length}`);
  } catch (err) {    console.error(`[${trigger}] Pipeline failed:`, err.message);
    await sendText(`⚠️ Pipeline failed on ${trigger}: ${err.message}`).catch(() => {});
  } finally {
    running = false;
  }
}

async function regenerateMeme(chatId) {
  const last = await readJson("last-draft.json", null);
  if (!last) {
    await reply(chatId, "No drafts yet — wait for the scheduled post or use /draft.");
    return;
  }
  await reply(chatId, "🎨 Cooking up a fresh Fonsi-Sniffer…");
  const slugs = await getTemplateSlugs();
  const meme = await generateMemeOnly(last.storyHint || last.topic || "tech news", slugs);
  const url = buildMemeUrl(meme);
  if (!DRY_RUN) {
    await tg.sendPhotoUrl(chatId, url, `Fonsi-Sniffer 🔥\n${url}`);
  } else {
    console.log("[dry-run] meme url:", url);
  }
  await writeJson("last-draft.json", { ...last, memeUrl: url });
}

// ---------- location handling ----------

async function handleSharedLocation(loc, chatId) {
  const point = { lat: loc.latitude, lon: loc.longitude };

  // /sethome flow: save base position.
  if (pendingSetHome.has(chatId)) {
    pendingSetHome.delete(chatId);
    await writeJson("home.json", { ...point, date: new Date().toISOString() });
    await reply(
      chatId,
      "✅ Home base saved. From now on /location will measure distance from here and draw routes."
    );
    return;
  }

  await reply(chatId, "🔎 Looking that up…");

  const place = (await reverseGeocode(point.lat, point.lon)) || `${point.lat.toFixed(5)}, ${point.lon.toFixed(5)}`;
  const home = await readJson("home.json", null);

  let geometry = null;
  const lines = [`📍 WHERE IS THIS?\n\nPlace: ${place}`];

  if (home) {
    const straightKm = haversineKm(home, point);
    const route = await osrmRoute(home, point);

    if (route) {
      geometry = route.geometry;
      lines.push(
        `Distance from your base: ${route.distanceKm.toFixed(1)} km drive (~${Math.round(route.durationMin)} min)` +
          ` · ${straightKm.toFixed(1)} km straight-line`
      );
    } else {
      lines.push(`Straight-line distance from your base: ${straightKm.toFixed(1)} km`);
    }

    lines.push("");
    lines.push(`🗺 Route: ${gmapsDirectionsLink(home, point)}`);
    lines.push(`🧭 OSM: ${osmDirectionsLink(home, point)}`);
  } else {
    lines.push("\nTip: send /sethome once so I can measure distance and draw routes for you.");
  }

  const caption = lines.join("\n");

  // Try to attach a drawn map; degrade gracefully to text-only.
  if (geometry && home && !DRY_RUN) {
    try {
      const png = await renderRouteMap(geometry, [
        { lat: home.lat, lon: home.lon, label: "HOME", color: "#2a9d8f" },
        { lat: point.lat, lon: point.lon, label: "TARGET", color: "#e63946" },
      ]);
      await tg.sendPhotoBuffer(chatId, png, caption);
      return;
    } catch (err) {
      console.error(`Map rendering failed, sending links only: ${err.message}`);
    }
  } else if (geometry && home && DRY_RUN) {
    console.log("[dry-run] would render route map with", geometry.length, "points");
  }

  await reply(chatId, caption);
}

// ---------- command router ----------

const HELP_TEXT =
  "*Tech Trends Bot — commands*\n\n" +
  "/draft — trigger the trending-story pipeline now\n" +
  "/latest — resend the most recent draft + Fonsi-Sniffer link\n" +
  "/meme — regenerate just the Fonsi-Sniffer meme\n" +
  "/location — share a spot; I'll name it, measure distance from your base and draw the route\n" +
  "/sethome — save your current position as the measuring base\n" +
  "/help — this list";

async function handleMessage(msg) {
  const chatId = msg.chat.id;

  if (msg.location) {
    try {
      await handleSharedLocation(msg.location, chatId);
    } catch (err) {
      console.error("Location handler failed:", err.message);
      await reply(chatId, `⚠️ That lookup failed: ${err.message}`).catch(() => {});
    }
    return;
  }

  const raw = msg.text || "";
  if (!raw.startsWith("/")) return;
  const cmd = raw.split("@")[0].trim().toLowerCase();

  try {
    switch (cmd) {
      case "/start":
      case "/help":
        await reply(chatId, HELP_TEXT, { parse_mode: "Markdown" });
        break;
      case "/draft":
        await reply(chatId, "⏳ Pulling trends and writing your draft…");
        await runPipeline("command");
        break;
      case "/latest": {
        const last = await readJson("last-draft.json", null);
        if (!last) {
          await reply(chatId, "No drafts yet.");
          break;
        }
        await reply(
          chatId,
          `*Latest draft* (${last.date})\n\n${last.paragraph}\n\n${
            last.memeUrl ? `Fonsi-Sniffer: ${last.memeUrl}` : "(no meme)"
          }`,
          { parse_mode: "Markdown" }
        );
        break;
      }
      case "/meme":
        await regenerateMeme(chatId);
        break;
      case "/location":
        await tg.sendMessage(
          chatId,
          "Tap below to share a location — I'll tell you where it is, how far it is from your base, and draw the route.",
          { reply_markup: tg.locationKeyboard() }
        );
        break;
      case "/sethome":
        pendingSetHome.add(chatId);
        await tg.sendMessage(
          chatId,
          "Tap below to save YOUR current position as home base (used for distances and routes).",
          { reply_markup: tg.locationKeyboard() }
        );
        break;
      default:
        await reply(chatId, "Unknown command. Try /help");
    }
  } catch (err) {
    console.error(`Command ${cmd} failed:`, err.message);
    await reply(chatId, `⚠️ Command failed: ${err.message}`).catch(() => {});
  }
}

// ---------- long-poll loop ----------

async function pollLoop() {
  let offset = 0;
  while (true) {
    try {
      const updates = await tg.getUpdates(offset);
      for (const u of updates) {
        offset = u.update_id + 1;
        if (u.message) await handleMessage(u.message);
      }
    } catch (err) {
      console.error("Poll error:", err.message);
      await new Promise((r) => setTimeout(r, 5000));
    }
  }
}

// ---------- boot ----------

function main() {
  for (const key of ["GROQ_API_KEY", "TELEGRAM_BOT_TOKEN", "TELEGRAM_CHAT_ID"]) {
    if (!process.env[key]) {
      console.error(`Missing required env var: ${key}`);
      process.exit(1);
    }
  }

  // HTTP health endpoint (Render web service + external keep-alive ping).
  http
    .createServer((req, res) => {
      res.writeHead(200, { "Content-Type": "text/plain" });
      res.end("tech-trends-poster alive\n");
    })
    .listen(process.env.PORT || 3000, () => console.log("Health endpoint up."));

  cron.schedule("0 3,11,19 * * *", () => runPipeline("schedule")); // 06/14/22 EAT
  console.log("Scheduler armed: 03:00 / 11:00 / 19:00 UTC.");

  pollLoop().catch((err) => {
    console.error("Fatal poll failure:", err);
    process.exit(1);
  });
  console.log("Long-polling started.");

  if (process.env.RUN_ON_START === "1") {
    setTimeout(() => runPipeline("boot"), 2000);
  }
}

main();
