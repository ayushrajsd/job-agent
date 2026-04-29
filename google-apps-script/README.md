# Job Agent — Google Apps Script Setup

Automated job pipeline running entirely inside Google Sheets + Apps Script.
No server. No hosting. Runs free on Google's infrastructure.

---

## What it does

| Layer | What runs | When |
|---|---|---|
| Fetch | SerpApi (Google Jobs) + Adzuna API + RSS feeds | Daily 9 AM IST |
| Deduplicate | Apps Script checks existing URLs before writing | On every fetch |
| Score | Claude Haiku scores each new JD 0-100 | Hourly |
| Digest | HTML email of all flagged roles (score >= 70) | Every Monday 9 AM IST |

---

## One-time setup (15 minutes)

### Step 1 — Create a Google Sheet

1. Go to [sheets.google.com](https://sheets.google.com) and create a new blank spreadsheet.
2. Name it anything (e.g. `Job Agent`).
3. Copy the spreadsheet URL — you'll need it in Step 3.

### Step 2 — Open Apps Script

1. In the spreadsheet, click **Extensions > Apps Script**.
2. Delete the default `Code.gs` file content.
3. Create the following files (click the `+` next to Files):

```
Config.gs
Sheet.gs
Sources.gs
Scorer.gs
Digest.gs
Triggers.gs
Main.gs
```

4. Paste the contents of each `.gs` file from this repo into the corresponding file.
5. Click **Save** (Ctrl+S / Cmd+S).

### Step 3 — Add API keys (Script Properties)

1. In Apps Script, click **Project Settings** (gear icon, left sidebar).
2. Scroll to **Script Properties** and click **Add script property** for each:

| Property name | Value |
|---|---|
| `ANTHROPIC_API_KEY` | Your Anthropic key from [console.anthropic.com](https://console.anthropic.com) |
| `SERPAPI_KEY` | Your SerpApi key from [serpapi.com](https://serpapi.com) (free: 100 searches/month) |
| `ADZUNA_APP_ID` | From [developer.adzuna.com](https://developer.adzuna.com) (free tier) |
| `ADZUNA_APP_KEY` | Same registration as above |

You can start without Adzuna — SerpApi + RSS feeds are enough to prove the pipeline.

### Step 4 — Add your LinkedIn RSS feed (optional but valuable)

1. Log into LinkedIn and go to **Jobs**.
2. Run your search: `developer advocate` → filter **Remote** → **Worldwide**.
3. Save the search (bell icon) — LinkedIn will offer email alerts.
4. To get the RSS URL, use a service like [feedle.net](https://feedle.net) or the
   [LinkedIn RSS bridge](https://github.com/RSS-Bridge/rss-bridge) (self-hostable).
5. Paste the URL into `Config.gs` in the `RSS_FEEDS` array under the `linkedin` entry.

### Step 5 — Run setup

1. In Apps Script, select `runSetup` from the function dropdown at the top.
2. Click **Run**.
3. Approve the permissions when prompted (Gmail send, Sheets access, external URLs).
4. Check the **Execution log** — you should see:
   ```
   Setup complete. Sheet ready. Triggers registered.
   ```

That's it. The pipeline is live.

---

## Testing the pipeline manually

Run these from the Apps Script editor (select function → Run):

| Function | What it does |
|---|---|
| `runAll` | Fetch + score in sequence (full test run) |
| `runDailyFetch` | Fetch sources only |
| `runScoring` | Score all pending rows only |
| `runDigest` | Send the digest email right now |
| `runStatus` | Print row counts by status to the log |
| `Triggers_list` | Print all active triggers to the log |

---

## The Google Sheet columns

| Column | What it shows |
|---|---|
| Date Found | When the row was added |
| Title | Job title |
| Company | Company name |
| Location | Location string from the source |
| Salary | Salary range if listed |
| Apply URL | Direct link to apply |
| Source | Which feed/API found it |
| Posted Date | When the role was posted |
| Score | Claude's 0-100 fit score |
| Category | devrel / ai-devrel / edtech / ai-eng / ai-trainer |
| Remote Confirmed | yes / no / verify |
| Resume Version | A (DevRel) / B (Hindi community) / C (AI engineer) |
| Top Keywords | 3 keywords to echo in your resume/cover note |
| Fit Summary | 2-sentence Claude analysis |
| Watch Out | Any concern flagged by Claude |
| Status | new → flagged (green) or archived (grey) → applied / rejected |
| JD Text | Raw JD text used for scoring (keep this column hidden) |

**Recommended sheet view:** hide column Q (JD Text), freeze row 1, filter to
`Status = flagged` for your weekly review.

---

## On-demand resume tailoring

When you see a flagged role you want to pursue:

1. Copy the **Apply URL** and open the full JD.
2. Open [claude.ai](https://claude.ai) and start a new chat.
3. Paste this prompt, then paste the full JD below it:

```
You are a resume tailoring assistant for Ayush Raj.
[paste the full RESUME_TAILOR_SYSTEM_PROMPT from src/config/candidate.ts]

JOB LISTING:
[paste JD here]
```

Or use the Node.js CLI in this repo:
```bash
node dist/index.js tailor --file <path-to-job-json> --rank 1 --cover-note
```

---

## Costs

| Service | Free tier | Estimated monthly use |
|---|---|---|
| SerpApi | 100 searches/month | ~150 (5 queries × 30 days) → upgrade to $50/mo plan or reduce to 2-3 queries |
| Adzuna | 250 req/month | ~120 (4 queries × 30 days) — comfortably free |
| Claude Haiku | Pay per token | ~$1-3/month (50 new JDs/week × 4 weeks × ~$0.01/JD) |
| Apps Script | Free | Always free for personal use |
| Google Sheets | Free | Always free |

**Total: under $5/month** once on SerpApi's $50/month plan, or **under $5/month** on the free tier if you limit to 3 SerpApi queries.

---

## Troubleshooting

**Sheet not created:** Run `runSetup` and approve all permissions.

**No jobs appearing:** Run `runDailyFetch` manually and check the execution log.
SerpApi and Adzuna errors will show there. RSS feeds are the most reliable fallback.

**Scoring stuck at 'new':** Run `runScoring` manually. Check that `ANTHROPIC_API_KEY`
is set correctly in Script Properties.

**Digest email not arriving:** Run `runDigest` manually. Check spam. Confirm
`CONFIG.DIGEST_EMAIL` matches your Google account email.

**Apps Script 6-minute timeout:** The scorer processes `CONFIG.MAX_SCORE_PER_RUN` (20)
jobs per run. If you have a large backlog, subsequent hourly runs will clear it.
