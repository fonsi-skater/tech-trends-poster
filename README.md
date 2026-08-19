# Tech Trends X Poster (100% Free, No Server Needed)

Runs 3x/day in the cloud (GitHub Actions), pulls a trending tech story from
Hacker News, writes ONE paragraph explaining it (sized to fit X's free-tier
280-char limit) using Groq's free LLM API, and sends it to your Telegram so
you can review and post it yourself.

No paid APIs anywhere in this pipeline. No X premium. No device of yours
needs to be running — GitHub's servers handle the schedule.

**Free stack used:**
- **Hacker News API** — trend discovery (no key required at all)
- **Groq API** — free-tier LLM (Llama 3.3), no credit card required to sign up
- **Telegram Bot API** — delivery to your phone (completely free)
- **GitHub Actions** — free scheduled runner (2,000 free minutes/month)

---

## 1. Create a Telegram bot (2 minutes) — you've already done this

You already have:
- `TELEGRAM_BOT_TOKEN` (from @BotFather)
- `TELEGRAM_CHAT_ID` → `6869309096`

If you haven't already, revoke and regenerate your bot token via
@BotFather → `/mybots` → your bot → API Token → Revoke current token,
since the original was shared in chat.

## 2. Get a free Groq API key

1. Go to https://console.groq.com
2. Sign up (no credit card required)
3. Go to **API Keys** → **Create API Key**
4. Copy it — this is your `GROQ_API_KEY`

## 3. Push this project to a GitHub repo

```bash
cd tech-trends-poster
git init
git add .
git commit -m "Initial commit: tech trends draft poster (free stack)"
git branch -M main
git remote add origin https://github.com/<your-username>/<repo-name>.git
git push -u origin main
```

## 4. Add your secrets to GitHub

In your repo: **Settings → Secrets and variables → Actions → New repository secret**

Add these three:
- `GROQ_API_KEY`
- `TELEGRAM_BOT_TOKEN`
- `TELEGRAM_CHAT_ID` → `6869309096`

## 5. Test it manually

Go to the **Actions** tab in your repo → select "Tech Trends Draft Poster" →
click **Run workflow**. Check your Telegram — you should get a draft within
about a minute.

## 6. Let it run on schedule

Once tested, it runs automatically at the three times set in
`.github/workflows/post.yml` (default: ~8am, 2pm, 8pm Nairobi time).
Edit the cron times there if you want different hours — GitHub Actions
cron times are in UTC (Nairobi is UTC+3).

---

## Notes

- **No npm install needed** — the script only uses Node's built-in `fetch`,
  no external packages. Node 18+ (GitHub Actions uses Node 20) has this
  built in.
- **Character limit**: targets 260 chars, flags with ⚠️ in the Telegram
  message if a draft comes in over X's 280-char limit, so you can trim
  before posting.
- **Groq free tier limits**: generous for this use case (a handful of
  requests per day) — well within free-tier rate limits. Check
  https://console.groq.com/settings/limits if you ever hit a wall.
- **GitHub Actions free tier**: 2,000 min/month on private repos,
  unlimited on public repos — this job takes well under a minute per run.
