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

  // Claude model for scoring (Haiku = cheap + fast, sufficient for structured output)
  CLAUDE_MODEL:       'claude-haiku-4-5-20251001',

  // Jobs with score >= this are flagged; below are archived
  SCORE_THRESHOLD:    70,

  // Max jobs to score per hourly run (avoids hitting the 6-min execution limit)
  MAX_SCORE_PER_RUN:  20,

  // RSS feeds — add your LinkedIn saved-search RSS URL under 'linkedin'
  RSS_FEEDS: [
    {
      name:   'startup.jobs — devrel',
      url:    'https://startup.jobs/rss?role=developer-advocate&remote=true',
    },
    {
      name:   'startup.jobs — ai',
      url:    'https://startup.jobs/rss?role=ai&remote=true',
    },
    {
      name:   'remoteok — devrel',
      url:    'https://remoteok.com/remote-developer-relations-jobs.rss',
    },
    {
      name:   'weworkremotely — devrel',
      url:    'https://weworkremotely.com/categories/remote-full-stack-programming-jobs.rss',
    },
    // Uncomment and paste your LinkedIn saved-search RSS URL:
    // { name: 'linkedin — devrel', url: 'PASTE_YOUR_LINKEDIN_RSS_URL_HERE' },
    // { name: 'linkedin — ai-devrel', url: 'PASTE_YOUR_SECOND_LINKEDIN_RSS_URL_HERE' },
  ],

  // SerpApi — Google Jobs queries (run each independently, results merged)
  SERPAPI_QUERIES: [
    'developer advocate remote worldwide',
    'developer relations remote India',
    'AI developer advocate remote',
    'technical evangelist remote worldwide',
    'devrel engineer remote',
  ],

  // Adzuna — (what, where) pairs; using 'us' endpoint for widest English coverage
  ADZUNA_QUERIES: [
    { what: 'developer advocate', where: 'remote' },
    { what: 'developer relations',  where: 'remote' },
    { what: 'AI developer advocate', where: 'remote' },
    { what: 'technical instructor AI', where: 'remote' },
  ],
};

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
  JD_TEXT:          17,  // kept last; hide this column in the sheet view
};

const SHEET_HEADERS = [
  'Date Found', 'Title', 'Company', 'Location', 'Salary',
  'Apply URL', 'Source', 'Posted Date', 'Score', 'Category',
  'Remote Confirmed', 'Resume Version', 'Top Keywords',
  'Fit Summary', 'Watch Out', 'Status', 'JD Text',
];

// ─── SCORING SYSTEM PROMPT ───────────────────────────────────────────────────
// Condensed profile used only for scoring (full profile used in resume tailor).
const SCORING_SYSTEM_PROMPT = `
You are a job-fit scoring assistant for Ayush Raj.

CANDIDATE SNAPSHOT:
- 13+ years: Intel → GlobalLogic → Scaler (current)
- Current role: Lead Instructor & AI Product Lead at Scaler
- Skills: JavaScript, TypeScript, Node.js, React, Next.js, Python, FastAPI
- AI stack: Claude API, OpenAI, Groq, LangChain, CrewAI, SerpApi, RAG, pgvector
- DevRel: live sessions to 1,000+ devs, 5-star rating, YouTube (11 videos), LinkedIn AI posts
- Location: Pune, India — remote only, no relocation
- Languages: Hindi (native), English (full professional)

SCORING RUBRIC (total 100 points):

Location (30 pts):
  30 = confirmed remote worldwide / India eligible
  15 = remote but country not confirmed — mark remote_confirmed as "verify"
   0 = US/EU/UK only — set score to 0 and return immediately

Category (25 pts):
  25 = developer advocate / devrel / AI devrel / technical evangelist
  20 = technical instructor / curriculum lead / developer education
  15 = AI engineer / LLM engineer / full-stack AI / RAG engineer
  10 = AI trainer / AI evaluator / prompt engineer

Skills match (25 pts):
  5 pts each for strong match in: JavaScript, React/Node.js, AI/LLMs,
  content creation / community / teaching, Hindi-speaker advantage. Max 25.

Company fit (10 pts):
  10 = developer-tool company, AI API company, open-source startup
   5 = edtech or enterprise software
   2 = generic company (DevRel not a core function)

Recency (10 pts):
  10 = posted within 7 days
   7 = posted 8-14 days ago
   4 = posted 15-30 days ago
   0 = older than 30 days

RESUME VERSION GUIDE:
  A = DevRel / JS educator focus
  B = Hindi / India community focus
  C = AI engineer / full-stack AI focus

Return ONLY a JSON object. No prose, no explanation, no markdown fences.
Schema:
{
  "score": <integer 0-100>,
  "category": <"devrel"|"ai-devrel"|"edtech"|"ai-eng"|"ai-trainer">,
  "remote_confirmed": <"yes"|"no"|"verify">,
  "resume_version": <"A"|"B"|"C">,
  "top_keywords": [<string>, <string>, <string>],
  "fit_summary": "<2 sentences max>",
  "watch_out": "<1 sentence or empty string>"
}
`.trim();
