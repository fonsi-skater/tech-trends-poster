// src/meme.js
// FONSI-SNIFFER meme builder.
// Engine: memegen.link — no account, no key. We keep a cached catalog of
// valid template slugs (so the LLM can't invent broken ones), and turn a
// {template, top_text, bottom_text} spec into a hosted PNG URL.

const CATALOG_URL = "https://api.memegen.link/templates/";
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

let cache = { at: 0, slugs: [] };

export async function getTemplateSlugs(force = false) {
  const now = Date.now();
  if (!force && cache.slugs.length && now - cache.at < CACHE_TTL_MS) {
    return cache.slugs;
  }
  try {
    const res = await fetch(CATALOG_URL, { signal: AbortSignal.timeout(15000) });
    if (!res.ok) throw new Error(`status ${res.status}`);
    const templates = await res.json();
    // Template "id" is the URL slug; prefer 2-line formats (top/bottom text)
    // since our spec is exactly that shape, then fall back to the rest.
    const twoLine = templates.filter((t) => t && t.id && t.lines === 2).map((t) => t.id);
    const others = templates.filter((t) => t && t.id && t.lines !== 2).map((t) => t.id);
    const slugs = [...twoLine, ...others];
    if (slugs.length) cache = { at: now, slugs };
    return cache.slugs;
  } catch (err) {
    console.warn(`Meme template catalog fetch failed (${err.message}) — using cached/empty list.`);
    return cache.slugs;
  }
}

// memegen.link URL conventions:
//   "_" = blank line, spaces may be given as underscores, "/" is the line
//   separator so it must never appear inside a caption.
function sanitize(text, maxLen) {
  return String(text || "")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[_#?&%]/g, " ")
    .replace(/\//g, " ")
    .slice(0, maxLen);
}

export function buildMemeUrl(spec) {
  const template = sanitize(spec.template, 40).replace(/\s+/g, "") || "drake";
  const encode = (text) => {
    const clean = sanitize(text, 64);
    if (!clean) return "_";
    return encodeURIComponent(clean).replace(/%20/g, "_");
  };
  return `https://api.memegen.link/images/${template}/${encode(spec.top_text)}/${encode(spec.bottom_text)}.png`;
}

export function normalizeMemeSpec(spec, validSlugs) {
  if (!spec || typeof spec !== "object") return null;
  let template = String(spec.template || "").trim().toLowerCase();
  if (validSlugs.length && !validSlugs.includes(template)) {
    template = validSlugs.includes("drake") ? "drake" : validSlugs[0];
    if (!validSlugs.length) template = "drake"; // catalog unavailable — best guess
  }
  return {
    template,
    top_text: String(spec.top_text || "").slice(0, 80),
    bottom_text: String(spec.bottom_text || "").slice(0, 80),
  };
}
