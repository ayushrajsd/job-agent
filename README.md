# Job Agent — Agentic Job System for Ayush Raj

Two-agent pipeline built on the Claude API:

1. **Job Finder Agent** — searches job boards daily, scores listings against Ayush's profile, and returns up to 10 qualifying roles as JSON.
2. **Resume Tailor Agent** — takes a job listing and produces a tailored resume (markdown) with match analysis, changes summary, and optional cover note.

---

## Setup

```bash
# 1. Clone and install
git clone <repo>
cd job-agent
npm install

# 2. Configure environment
cp .env.example .env
# Edit .env and add your keys:
#   ANTHROPIC_API_KEY=sk-ant-...
#   SERPAPI_KEY=...          (required for Job Finder)

# 3. Build
npm run build
```

---

## Usage

### Find jobs (Job Finder Agent)

```bash
node dist/index.js find
```

Searches all configured job boards, scores listings, and saves results to `output/jobs/YYYY-MM-DD.json`. Prints a summary table to stdout.

### Tailor resumes (Resume Tailor Agent)

```bash
# Tailor all jobs from the latest run
node dist/index.js tailor

# Tailor a specific job by rank
node dist/index.js tailor --rank 1

# Tailor with a cover note
node dist/index.js tailor --rank 2 --cover-note

# Tailor from a specific jobs file
node dist/index.js tailor --file output/jobs/2026-04-28.json
```

Resumes are saved to `output/resumes/YYYY-MM-DD/<company>_<title>.md`.

### Full pipeline

```bash
# Find jobs only (no auto-tailor)
node dist/index.js run

# Find + auto-tailor all qualifying listings
node dist/index.js run --auto-tailor

# Find + auto-tailor + include cover notes
node dist/index.js run --auto-tailor --cover-note
```

### Daily scheduler

```bash
node dist/index.js schedule
```

Runs the full pipeline every day at **9:00 AM IST** (3:30 AM UTC). Uses `AUTO_TAILOR` and `COVER_NOTE` environment variables to control behavior.

### Development (no build step)

```bash
npx ts-node src/index.ts find
npx ts-node src/index.ts tailor --rank 1
npx ts-node src/index.ts run --auto-tailor
npx ts-node src/index.ts schedule
```

---

## Environment variables

| Variable | Required | Default | Description |
|---|---|---|---|
| `ANTHROPIC_API_KEY` | Yes | — | Anthropic API key |
| `SERPAPI_KEY` | Yes (find) | — | SerpApi key for web search |
| `CLAUDE_MODEL` | No | `claude-sonnet-4-6` | Claude model to use |
| `AUTO_TAILOR` | No | `false` | Auto-tailor in `run` and `schedule` commands |
| `COVER_NOTE` | No | `false` | Include cover note in tailored output |
| `MAX_JOBS` | No | `10` | Max job listings per run |
| `VERBOSE` | No | `false` | Enable debug-level logging |

---

## Output

```
output/
  jobs/
    2026-04-28.json        # Job listings from Job Finder
  resumes/
    2026-04-28/
      supabase_developer-advocate.md
      mistral-ai_ai-developer-advocate.md
```

Each `output/resumes/.../foo.md` contains:
- Match analysis (strong match / partial match / gap per JD requirement)
- Resume changes summary
- Full tailored resume in markdown (ready for conversion to .docx)
- Cover note (if requested)

---

## Architecture

```
src/
  index.ts              CLI entry point (commander)
  orchestrator.ts       Pipeline: find -> save -> tailor -> save
  scheduler.ts          node-cron daily scheduler (9 AM IST)
  agents/
    agentLoop.ts        Reusable Claude API agentic loop with tool use
    jobFinder.ts        Job Finder Agent (web_search + web_fetch tools)
    resumeTailor.ts     Resume Tailor Agent (single-shot, no tools)
  tools/
    webSearch.ts        SerpApi integration
    webFetch.ts         HTML page fetcher with text extraction
  config/
    candidate.ts        Candidate profile + both agent system prompts
  types/
    index.ts            TypeScript interfaces
  utils/
    logger.ts           Timestamped logging
```

### Agentic loop

The Job Finder runs a full agentic loop: Claude calls `web_search` and `web_fetch` tools iteratively until it has enough data to produce the final JSON array. The loop supports up to 30 iterations and uses prompt caching on the system prompt to reduce API costs.

The Resume Tailor is a single-shot call (no tools needed) — it reasons over the base resume content embedded in the system prompt and produces structured markdown output.

Both agents use `cache_control: { type: 'ephemeral' }` on their (large) system prompts to benefit from prompt caching on repeated runs.
