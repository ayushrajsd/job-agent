# Job Agent — Agentic Job System for Ayush Raj

Four-layer automated pipeline: daily sourcing -> deduplication -> Claude scoring -> weekly digest.

```
Layer 1 — Sourcing (daily, automated)
  SerpApi (Google Jobs) + Adzuna API + LinkedIn RSS + startup.jobs RSS

Layer 2 — Collect & Deduplicate (Google Apps Script)
  Polls all sources, dedupes by URL, writes new rows to Google Sheet

Layer 3 — Claude Scoring (triggered hourly)
  Claude Haiku scores each JD 0-100 against Ayush's profile
  Score >= 70 → flagged (green). Below 70 → archived (grey).

Layer 4 — Weekly Digest
  HTML email every Monday: top 5 flagged roles with score, fit summary, apply link
  On-demand tailoring via the Node.js CLI or Claude.ai chat
```

---

## Primary system — Google Apps Script (Layers 1-4)

**Start here.** Runs free on Google's servers. No hosting needed.

See [`google-apps-script/README.md`](google-apps-script/README.md) for the full 15-minute setup guide.

**Files:**

| File | Role |
|---|---|
| `google-apps-script/Config.gs` | API keys, column constants, Claude scoring system prompt |
| `google-apps-script/Sheet.gs` | Google Sheets read/write, deduplication, status updates |
| `google-apps-script/Sources.gs` | SerpApi, Adzuna, RSS/Atom feed parsers |
| `google-apps-script/Scorer.gs` | Claude Haiku API call + JSON response parser |
| `google-apps-script/Digest.gs` | Weekly HTML email builder and sender |
| `google-apps-script/Triggers.gs` | Register/remove daily, hourly, weekly cron triggers |
| `google-apps-script/Main.gs` | Entry points: runSetup, runAll, runDailyFetch, runScoring, runDigest |

**Data sources configured:**

- `startup.jobs` RSS (devrel + AI)
- `remoteok.com` RSS (developer relations)
- `weworkremotely.com` RSS
- LinkedIn saved-search RSS (add your URL in Config.gs)
- SerpApi Google Jobs (5 queries: developer advocate, devrel, AI devrel, technical evangelist)
- Adzuna API (4 queries)

**Cost:** under $5/month total (Claude Haiku ~$1-3, SerpApi free tier or $50/month plan).

---

## On-demand resume tailor — Node.js CLI

For any flagged role you want to pursue, the Node.js Resume Tailor Agent produces a
tailored markdown resume with match analysis and optional cover note.

```bash
# Setup
npm install
cp .env.example .env   # add ANTHROPIC_API_KEY

# Tailor from a saved jobs JSON file
node dist/index.js tailor --file output/jobs/2026-04-28.json --rank 1
node dist/index.js tailor --rank 1 --cover-note

# Build
npm run build
```

Or paste the job description into [claude.ai](https://claude.ai) with the system prompt from
`src/config/candidate.ts` → `RESUME_TAILOR_SYSTEM_PROMPT`.

**Node.js source files:**

| File | Role |
|---|---|
| `src/config/candidate.ts` | Full candidate profile + both agent system prompts |
| `src/agents/resumeTailor.ts` | Resume Tailor Agent (single-shot Claude call) |
| `src/agents/jobFinder.ts` | Legacy agentic job finder (replaced by Apps Script) |
| `src/agents/agentLoop.ts` | Reusable Claude agentic loop with tool use |
| `src/orchestrator.ts` | File I/O, pipeline wiring |
| `src/index.ts` | CLI entry point |

---

## Environment variables (Node.js CLI only)

| Variable | Required | Description |
|---|---|---|
| `ANTHROPIC_API_KEY` | Yes | Anthropic key |
| `CLAUDE_MODEL` | No | Default: `claude-sonnet-4-6` |
| `COVER_NOTE` | No | `true` to include cover note |
| `VERBOSE` | No | `true` for debug logging |

Google Apps Script API keys are stored in **Script Properties**, not here.
