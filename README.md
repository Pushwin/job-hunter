# Job Hunter

Privacy-first job discovery for fresher and associate .NET, C#, Java and technical-consultant roles in Bangalore, Mangalore and Mysore. It never logs into LinkedIn, Indeed, email, or any third-party account.

## Run locally

1. Copy `.env.example` to `.env` and add a [SerpAPI key](https://serpapi.com/) plus a Telegram bot token and chat ID.
2. Replace the examples in `companies.json` with real public Greenhouse, Lever, and Ashby board tokens.
3. Run `npm install`, then `npm run dev`. Open `http://localhost:5173`.
4. Choose **Test Telegram** first, then **Search now**.

The default schedule is every 24 hours (`SCAN_INTERVAL_MINUTES=1440`). `JOB_MAX_AGE_HOURS=24` keeps only jobs with a verifiable timestamp inside the last day; listings with no timestamp are skipped rather than labelled as fresh. A full scan runs seven SerpAPI requests (two role searches for each city plus one Google Form search), which is about 210 calls/month on the free SerpAPI plan. `npm run scan` performs one scan, which suits a GitHub Actions schedule.

## Sources and privacy

- SerpAPI powers Google Jobs and Google Form discovery. No Google HTML is scraped.
- Greenhouse, Lever and Ashby only use their public job-board endpoints.
- Telegram offers no public cross-channel search API. To enable walk-in discovery, set `WALKIN_RSS_FEEDS` to comma-separated public, authorized RSS/export feeds for channels you are allowed to monitor. The app does not sign in to Telegram or scrape private channels.
- Jobs are deduplicated in local SQLite at `data/job-hunter.db`.

## Deploy

Push this folder to GitHub, create a Render web service from the repository, and Render will use `render.yaml`. Set the three secret environment variables in Render's dashboard. For durable history on Render, attach a persistent disk mounted to the app's `data` directory; otherwise SQLite is reset on deploy.

Application links open on the third-party website. Use a private window when applying.
