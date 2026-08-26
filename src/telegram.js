// src/telegram.js
// Thin helpers over the Telegram Bot API. JSON calls for text/photo-by-URL,
// multipart for photo uploads from a buffer (rendered route maps).

const apiBase = () => `https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}`;

async function call(method, body) {
  const signal = AbortSignal.timeout(40000);
  const res = await fetch(`${apiBase()}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal,
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || json.ok === false) {
    throw new Error(`Telegram ${method} failed: ${res.status} ${JSON.stringify(json).slice(0, 300)}`);
  }
  return json.result;
}

export function sendMessage(chatId, text, extra = {}) {
  return call("sendMessage", { chat_id: chatId, text, ...extra });
}

export function sendPhotoUrl(chatId, url, caption, extra = {}) {
  return call("sendPhoto", { chat_id: chatId, photo: url, caption, ...extra });
}

export async function sendPhotoBuffer(chatId, buffer, caption, extra = {}) {
  const form = new FormData();
  form.append("chat_id", String(chatId));
  if (caption) form.append("caption", caption);
  Object.entries(extra).forEach(([k, v]) =>
    form.append(k, typeof v === "string" ? v : JSON.stringify(v))
  );
  form.append("photo", new Blob([buffer], { type: "image/png" }), "photo.png");

  const signal = AbortSignal.timeout(60000);
  const res = await fetch(`${apiBase()}/sendPhoto`, { method: "POST", body: form, signal });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || json.ok === false) {
    throw new Error(`Telegram sendPhoto failed: ${res.status} ${JSON.stringify(json).slice(0, 300)}`);
  }
  return json.result;
}

// One-tap consent keyboard — the ONLY way this bot ever receives a location.
export function locationKeyboard() {
  return {
    keyboard: [[{ text: "📍 Share my location", request_location: true }]],
    resize_keyboard: true,
    one_time_keyboard: true,
  };
}

export function getUpdates(offset) {
  return call("getUpdates", {
    offset,
    timeout: 25,
    allowed_updates: ["message"],
  });
}
