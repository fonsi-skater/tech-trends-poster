# Tech Trends Poster v2 — Implementation Plan

Status: IMPLEMENTED (v2). Phases 1-4 built and smoke-tested. See README.md
for run/deploy instructions. Backlog items below remain open.

## What changes architecturally

Today: stateless script fired 3x/day by GitHub Actions cron. Fire-and-forget.

v2: small **always-on Node service** so the bot can listen (commands, shared
locations) and respond instantly. Scheduling moves in-process; GitHub Actions
cron is retired after cutover.

### Hosting (always-on, $0)
- **Primary: Render free web service** — deploys straight from this GitHub
  repo, zero cloud console work. Free instances sleep after 15 min idle, so
  the bot uses **long-polling** + a free keep-alive ping (cron-job.org, every
  10 min) to stay warm.
- Alternates if Render disappoints: Google Cloud Run (webhook mode, scale-to-zero),
  Oracle Cloud Always Free VPS (true always-on VM, needs card at signup).

## New project layout

```
src/
  server.js      entrypoint — starts Telegram long-poll loop + in-process scheduler
  telegram.js    Bot API helpers: sendMessage, sendPhoto, getUpdates, reply keyboards
  sources.js     HN + Reddit fetchers (extracted from current postDraft.js)
  draft.js       Groq paragraph generation (existing logic, modularized)
  meme.js        FONSI-SNIFFER meme builder
  location.js    Nominatim reverse geocode, haversine distance, OSRM routing
  map.js         OSM tile stitching + route polyline drawing -> PNG
  store.js       data/*.json read/write (topic history, home coordinates)
data/
  recent-topics.json   existing
  home.json            new — /sethome base coordinates
.github/workflows/post.yml   retired after successful cutover
```

## Feature 1 — Fonsi-Sniffer (meme links)

Every daily draft ships with a branded meme link.

- Engine: **memegen.link** — no account, no key, no deps. Template catalog
  fetched once from `api.memegen.link/v2/templates/` and cached in memory.
- The existing Groq call gains `response_format: json_object` and returns:
  `{ "paragraph": "...", "topic": "...", "meme": { "template": "drake",
  "top_text": "...", "bottom_text": "..." } }` — captions short, punchy,
  derived from the chosen story.
- Meme URL built as `https://api.memegen.link/images/{template}/{top}/{bottom}.png`
- Delivery: `sendPhoto` (Telegram pulls the image by URL) with caption
  labeling it as a **Fonsi-Sniffer link**, plus the raw URL pasted in the
  message so it can be copied straight to X alongside the paragraph.
- Fallback: any meme failure degrades gracefully to today's text-only draft.

## Feature 2 — Location ("where is this?")

Consent-based only: locations are received exclusively through Telegram's
native `request_location` button. No tracking of anyone who hasn't tapped
share themselves.

Commands:
- `/sethome` — share your own position once; stored to `data/home.json`
  (committed back to repo, same pattern as topic history).
- `/location` — anyone taps the share button; bot responds with:

1. **Place name** — Nominatim reverse geocode (free, no key, descriptive
   User-Agent required).
2. **Straight-line distance** — haversine vs your `/sethome` point.
3. **Real driving distance + ETA** — OSRM public router
   (`router.project-osrm.org`, free, no key); falls back to haversine +
   Google Maps directions deep-link if OSRM is down.
4. **Drawn route map** (confirmed choice):
   - OSRM returns the route GeoJSON geometry
   - `@napi-rs/canvas` stitches OSM tiles covering the route bbox
     (zoom ~12, light personal use, proper User-Agent per OSM tile policy)
   - Polyline + start/end pins drawn on top -> PNG buffer -> `sendPhoto`
   - Caption: place name, X km away, ~Y min drive.

## Command set (v2)

`/latest` (last digest again) · `/draft` (trigger pipeline on demand) ·
`/meme` (regenerate just the meme) · `/location` · `/sethome` · `/help`

## Dependencies added

Only two: `@napi-rs/canvas` (map drawing) and `node-cron` (in-process
schedule). Everything else stays on native `fetch`.

## Security & ops notes

- All secrets (GROQ_API_KEY, TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID) move from
  GitHub Secrets to Render environment variables.
- Rotate the Telegram bot token before going live (it predates this plan).
- `DRY_RUN=1` env flag: run the full pipeline but log instead of sending.
- OSM/Nominatim usage kept light and attributed (personal-scale, well within
  their fair-use policies).

## Build order

1. **Phase 1 — Skeleton & hosting:** refactor into modules, add telegram.js
   long-polling + command router, deploy to Render, retire GH Actions cron.
2. **Phase 2 — Fonsi-Sniffer:** meme spec via Groq JSON mode, sendPhoto flow.
3. **Phase 3 — Location core:** /sethome, /location, geocode + distances +
   directions links.
4. **Phase 4 — Map rendering:** tile stitching + polyline PNG.
5. **Backlog (post-v2 ideas):** direct auto-post to X (kept manual per owner
   decision), branded news cards via satori, thread mode, extra sources
   (Dev.to/Lobsters/RSS), local fuzzy dedup, weekly analytics recap.

## Open defaults (owner can override)

- Meme engine: memegen.link (owner's "Fonsi-Sniffer" = product name, not an API)
- Host: Render free tier
- Post schedule unchanged: 06:00 / 14:00 / 22:00 EAT
