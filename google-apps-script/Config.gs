// ─── CONFIG ──────────────────────────────────────────────────────────────────
// All keys are stored in Script Properties (File > Project settings > Script properties)
// Never hard-code API keys here.

const CONFIG = {
  // API keys — set via Script Properties, not here
  ANTHROPIC_API_KEY:  PropertiesService.getScriptProperties().getProperty('ANTHROPIC_API_KEY'),
  SERPAPI_KEY:        PropertiesService.getScriptProperties().getProperty('SERPAPI_KEY'),
  ADZUNA_APP_ID:      PropertiesService.getScriptProperties().getProperty('ADZUNA_APP_ID'),
  ADZUNA_APP_KEY:     PropertiesService.getScriptProperties().getProperty('ADZUNA_APP_KEY'),

  // Sheet config
  SHEET_NAME:         'Jobs',
  DIGEST_EMAIL:       'ayush.raj1806@gmail.com',

  // Claude model for scoring (Haiku = cheap + fast)
  CLAUDE_MODEL:       'claude-haiku-4-5-20251001',

  // Score threshold: >= flagged (green), < archived (grey)
  SCORE_THRESHOLD:    70,

  // Max rows to score per hourly run (keeps execution under 6-min limit)
  MAX_SCORE_PER_RUN:  20,

  // ── SOURCE 1: Remotive API ─────────────────────────────────────────────────
  // Free JSON API. Every listing is remote. Has candidate_required_location field.
  // Best quality source — runs first.
  REMOTIVE_SEARCHES: [
    // Category + optional keyword search
    { category: 'developer-relations', search: '' },
    { category: 'developer-relations', search: 'AI' },
    { category: 'software-dev',        search: 'developer advocate' },
    { category: 'software-dev',        search: 'AI engineer' },
    { category: 'software-dev',        search: 'LLM engineer' },
    { category: 'software-dev',        search: 'full stack AI' },
    { category: 'all-others',          search: 'developer advocate' },
    { category: 'all-others',          search: 'devrel' },
  ],

  // ── SOURCE 2: RSS feeds ────────────────────────────────────────────────────
  // Only keyword-targeted search feeds — no broad category feeds.
  RSS_FEEDS: [
    // startup.jobs — role-specific (these URLs reliably return job listings)
    { name: 'startup.jobs — devrel',    url: 'https://startup.jobs/rss?role=developer-advocate&remote=true' },
    { name: 'startup.jobs — ai-eng',    url: 'https://startup.jobs/rss?role=software-engineer&tag=ai&remote=true' },
    // WeWorkRemotely — keyword search (not category; avoids the broad category noise)
    { name: 'wwr — developer advocate', url: 'https://weworkremotely.com/remote-jobs/search.rss?term=developer+advocate' },
    { name: 'wwr — devrel',             url: 'https://weworkremotely.com/remote-jobs/search.rss?term=devrel' },
    { name: 'wwr — AI engineer',        url: 'https://weworkremotely.com/remote-jobs/search.rss?term=AI+engineer' },
    { name: 'wwr — LLM engineer',       url: 'https://weworkremotely.com/remote-jobs/search.rss?term=LLM+engineer' },
    // Himalayas — excellent remote-only board
    { name: 'himalayas — devrel',       url: 'https://himalayas.app/jobs/rss?q=developer+advocate' },
    { name: 'himalayas — AI eng',       url: 'https://himalayas.app/jobs/rss?q=AI+engineer' },
    // Uncomment and paste your LinkedIn saved-search RSS URLs:
    // { name: 'linkedin — devrel',      url: 'PASTE_LINKEDIN_RSS_URL' },
    // { name: 'linkedin — AI devrel',   url: 'PASTE_LINKEDIN_RSS_URL_2' },
  ],

  // ── SOURCE 3: SerpApi — Google Jobs ───────────────────────────────────────
  // Free tier: 100 searches/month = ~3/day. Keep to 5 queries max.
  // Append "India" or "worldwide" to bias results toward global remote.
  SERPAPI_QUERIES: [
    'developer advocate remote worldwide',
    'developer relations engineer remote India',
    'AI developer advocate remote worldwide',
    'LLM engineer remote India',
    'full stack AI engineer remote worldwide',
  ],

  // ── SOURCE 4: Adzuna ──────────────────────────────────────────────────────
  // Free tier: 250 req/month. Using 'gb' endpoint for UK listings (many are worldwide remote).
  ADZUNA_QUERIES: [
    { what: 'developer advocate',   endpoint: 'us' },
    { what: 'developer relations',  endpoint: 'gb' },
    { what: 'AI developer advocate',endpoint: 'us' },
    { what: 'LLM engineer',         endpoint: 'us' },
    { what: 'full stack AI engineer',endpoint: 'gb' },
    { what: 'technical instructor AI', endpoint: 'us' },
  ],
};

// ─── POSITIVE KEYWORD FILTER ──────────────────────────────────────────────────
// Job title OR JD must contain at least one of these. Zero API cost.
const FILTER_KEYWORDS = [
  // Category 1 & 2 — DevRel (highest priority)
  'developer advocate',
  'developer relations',
  'devrel',
  'technical evangelist',
  'developer experience',
  'dx engineer',
  'community engineer',
  'community advocate',
  'ai developer advocate',
  'ai devrel',
  'ml developer advocate',
  // Category 3 — Edtech / Instructor
  'technical instructor',
  'curriculum lead',
  'curriculum developer',
  'developer education',
  'instructional designer',
  'technical trainer',
  'developer educator',
  // Category 4 — AI / Full-Stack Engineer
  'llm engineer',
  'ai engineer',
  'full-stack ai',
  'full stack ai',
  'rag engineer',
  'agentic',
  'generative ai engineer',
  'ml engineer',
  'mern stack',
  'next.js engineer',
  // Category 5 — AI Trainer
  'ai trainer',
  'ai evaluator',
  'prompt engineer',
  'rlhf',
];

// ─── NEGATIVE TITLE KEYWORDS ──────────────────────────────────────────────────
// If the JOB TITLE contains any of these, reject immediately regardless of JD.
// Applied to title only — keeps it precise, avoids false positives on JD text.
const NEGATIVE_TITLE_KEYWORDS = [
  // Web3 / Blockchain specialist roles — no portfolio match for Ayush
  'web3',
  'blockchain',
  'crypto',
  'defi',
  'nft',
  'solidity',
  'smart contract',
  // Language-specific roles Ayush can't fill
  'mandarin',
  'japanese',
  'korean',
  'arabic',
  'german speaking',
  'french speaking',
  'spanish speaking',
  // Clearly non-technical roles that share keywords
  'sales advocate',
  'patient advocate',
  'customer advocate',
  'brand advocate',
  'health advocate',
  'insurance advocate',
];

// ─── LOCATION REJECT PATTERNS ─────────────────────────────────────────────────
// Checked against JD text (lowercase). Hard-reject if any match.
// These phrases mean the role explicitly requires US work authorisation.
const LOCATION_REJECT_PATTERNS = [
  'must be authorized to work in the us',
  'must be authorized to work in the united states',
  'authorized to work in the us ',
  'us work authorization required',
  'authorized to work in the united states',
  'legally authorized to work in the us',
  'us citizens and permanent residents',
  'open to candidates in the us only',
  'this role is open to us',
  'must reside in the united states',
  'must be based in the us',
  'must be located in the us',
  'candidates must be located in the us',
  'not able to sponsor',          // combined with US-only context
  'limited to united states',
];

// ─── SHEET COLUMN INDICES (1-based, matches Apps Script getRange) ─────────────
const COLS = {
  DATE_FOUND:       1,
  TITLE:            2,
  COMPANY:          3,
  LOCATION:         4,
  SALARY:           5,
  APPLY_URL:        6,
  SOURCE:           7,
  POSTED_DATE:      8,
  SCORE:            9,
  CATEGORY:         10,
  REMOTE_CONFIRMED: 11,
  RESUME_VERSION:   12,
  TOP_KEYWORDS:     13,
  FIT_SUMMARY:      14,
  WATCH_OUT:        15,
  STATUS:           16,
  JD_TEXT:          17,
};

const SHEET_HEADERS = [
  'Date Found', 'Title', 'Company', 'Location', 'Salary',
  'Apply URL', 'Source', 'Posted Date', 'Score', 'Category',
  'Remote Confirmed', 'Resume Version', 'Top Keywords',
  'Fit Summary', 'Watch Out', 'Status', 'JD Text',
];

// ─── SCORING SYSTEM PROMPT ────────────────────────────────────────────────────
const SCORING_SYSTEM_PROMPT = `
You are a job-fit scoring assistant for Ayush Raj, a senior JavaScript engineer
and technical educator based in Pune, India. He is remote-only and cannot relocate.

CANDIDATE SNAPSHOT:
- 13+ years: Intel → GlobalLogic → Scaler (current Lead Instructor & AI Product Lead)
- Skills: JavaScript, TypeScript, Node.js, React, Next.js, Python, FastAPI
- AI stack: Claude API, OpenAI, Groq, LangChain, CrewAI, SerpApi, RAG, pgvector
- DevRel: live sessions to 1,000+ devs, 5-star rating, YouTube (11 videos), LinkedIn AI posts
- Location: Pune, India — REMOTE ONLY, will not relocate under any circumstances
- Languages: Hindi (native), English (full professional)

STEP 1 — LOCATION CHECK (do this first, before any other scoring):
Read the full job description carefully for these signals:

HARD REJECT (set score to 0, return immediately):
  - Any of these phrases in the JD:
    "must be authorized to work in the US"
    "US work authorization required"
    "must reside in [country]"
    "must be based in [specific country that is not India]"
    "legally authorized to work in the United States"
    "candidates must be in [US city / EU country]"
  - Role explicitly listed as on-site or hybrid requiring physical presence
  - candidate_required_location field says "USA only", "Europe only", "UK only", etc.

SCORE 30 (confirmed worldwide / India eligible):
  - "remote worldwide", "global remote", "work from anywhere"
  - "India" explicitly mentioned as eligible location
  - "APAC" eligible, or no geographic restriction stated at all
  - candidate_required_location is "Worldwide" or empty

SCORE 15 (unconfirmed — flag for human review):
  - Says "remote" but country/region is ambiguous or not stated
  - Location field shows a specific country but JD doesn't mention restrictions

STEP 2 — SCORE THE REMAINING DIMENSIONS (only if location score > 0):

Category (25 pts):
  25 = developer advocate / devrel / AI devrel / technical evangelist / community engineer
  20 = technical instructor / curriculum lead / developer education / developer educator
  15 = AI engineer / LLM engineer / full-stack AI / RAG engineer / MERN AI
  10 = AI trainer / AI evaluator / prompt engineer / RLHF

Skills match (25 pts — 5 pts each, max 25):
  JavaScript or TypeScript in JD → 5 pts
  React / Node.js / Next.js in JD → 5 pts
  AI / LLMs / Claude / OpenAI / LangChain in JD → 5 pts
  Content creation / community / teaching / live sessions in JD → 5 pts
  Hindi speaker advantage or India-market focus mentioned → 5 pts

Company fit (10 pts):
  10 = developer-tool company, AI API company, open-source startup
   5 = edtech company or enterprise software
   2 = generic company where DevRel is not a core function

Recency (10 pts):
  10 = posted within 7 days
   7 = posted 8–14 days ago
   4 = posted 15–30 days ago
   0 = older than 30 days or date unknown

RESUME VERSION:
  A = DevRel / JS educator focus
  B = Hindi / India community focus
  C = AI engineer / full-stack AI focus

Return ONLY a JSON object. No prose, no markdown fences.
{
  "score": <integer 0-100>,
  "category": <"devrel"|"ai-devrel"|"edtech"|"ai-eng"|"ai-trainer">,
  "remote_confirmed": <"yes"|"no"|"verify">,
  "resume_version": <"A"|"B"|"C">,
  "top_keywords": [<string>, <string>, <string>],
  "fit_summary": "<2 sentences — be specific about why this fits Ayush>",
  "watch_out": "<1 sentence on the biggest concern, or empty string>"
}
`.trim();
