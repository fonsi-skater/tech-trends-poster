# Tech Trends Bot v2 (100% free stack, always-on)

An always-on Telegram bot that:
1. Pulls trending tech stories from Hacker News + r/technology + r/programming
2. Has Groq's free LLM pick the freshest cross-platform topic (avoiding repeats)
   and write a sub-180-char X draft **plus a Fonsi-Sniffer meme** (memegen.link)
3. Sends both to your Telegram for manual posting to X
4. Answers commands any time — including **/location**: share a spot, get its
   real place name, driving distance/ETA from your saved base (OSRM), and a
   **rendered route map** stitched from OpenStreetMap tiles.

## Commands

| Command | What it does |
|---|---|
| `/draft` | Run the trending-story pipeline right now |
| `/latest` | Resend the most recent draft + Fonsi-Sniffer link |
| `/meme` | Regenerate just the Fonsi-Sniffer meme for the last story |
| `/location` | Share a location → place name, distance, route map |
| `/sethome` | Save your current position as the measuring base |
| `/help` | List commands |

## Free stack

- **Hacker News API / Reddit JSON** — trend discovery (no keys)
- **Groq API** — free-tier LLM (`openai/gpt-oss-120b`), JSON mode
- **memegen.link** — meme rendering, no account needed
- **Nominatim** — reverse geocoding (no key)
- **OSRM public router** — driving distance/ETA/route geometry (no key)
- **OpenStreetMap tiles + @napi-rs/canvas** — route map rendering
- **Telegram Bot API** — delivery + long polling
- **Render free web service** — hosting (see `render.yaml`)
- **node-cron** — in-process schedule (03:00 / 11:00 / 19:00 UTC = 06/14/22 EAT)

Only two npm dependencies: `@napi-rs/canvas`, `node-cron`.

## Run it

### Locally

```bash
npm install
GROQ_API_KEY=... TELEGRAM_BOT_TOKEN=... TELEGRAM_CHAT_ID=... npm start
# or on Windows PowerShell:
$env:GROQ_API_KEY="..."; $env:TELEGRAM_BOT_TOKEN="..."; $env:TELEGRAM_CHAT_ID="..."; npm start
```

Useful flags: `DRY_RUN=1` (log instead of send), `RUN_ON_START=1` (fire a
pipeline immediately on boot — handy for deploy testing).

### Deploy to Render (free)

1. Push this repo to GitHub.
2. On render.com: **New → Blueprint**, point it at the repo (`render.yaml`
   is preconfigured).
3. Set the three env vars when prompted: `GROQ_API_KEY`,
   `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`.
4. After first deploy, keep the free instance awake: create a free
   cron-job.org ping to `https://<your-app>.onrender.com/` every 10 minutes
   (free Render instances sleep after 15 idle minutes; the HTTP endpoint
   here returns `tech-trends-poster alive` for exactly this).

### Legacy GitHub Actions path

`.github/workflows/post.yml` is kept as a **manual-only** backup (Actions
tab → Run workflow). Do not re-enable its schedule while the Render service
is live — two pipelines would fight over `data/recent-topics.json`.

## Data (committed back to the repo)

- `data/recent-topics.json` — last 12 topics, prevents repeats
- `data/home.json` — your `/sethome` base coordinates
- `data/last-draft.json` — most recent draft (powers `/latest` and `/meme`)

## Privacy notes

- Locations are only ever received via Telegram's native consent button —
  the bot cannot and does not locate anyone who hasn't tapped share.
- OSM/Nominatim/OSRM usage is personal-scale with proper User-Agents,
  within their fair-use policies. Map images carry the required
  OpenStreetMap attribution.
