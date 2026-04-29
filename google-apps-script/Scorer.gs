// ─── CLAUDE SCORING ───────────────────────────────────────────────────────────

/**
 * Calls Claude Haiku to score a single job and returns parsed scoreData.
 * Returns null if the API call fails or the response can't be parsed.
 */
function Scorer_scoreJob(job) {
  if (!CONFIG.ANTHROPIC_API_KEY) {
    throw new Error('ANTHROPIC_API_KEY not set in Script Properties.');
  }

  const userMessage = [
    `Title:    ${job.title}`,
    `Company:  ${job.company}`,
    `Location: ${job.location}`,
    `Salary:   ${job.salary || 'not listed'}`,
    `Source:   ${job.source}`,
    '',
    'Job description:',
    job.jdText || '(no description available)',
  ].join('\n');

  const payload = {
    model:      CONFIG.CLAUDE_MODEL,
    max_tokens: 512,
    system:     SCORING_SYSTEM_PROMPT,
    messages:   [{ role: 'user', content: userMessage }],
  };

  const options = {
    method:           'post',
    contentType:      'application/json',
    headers: {
      'x-api-key':          CONFIG.ANTHROPIC_API_KEY,
      'anthropic-version':  '2023-06-01',
    },
    payload:          JSON.stringify(payload),
    muteHttpExceptions: true,
  };

  const response = UrlFetchApp.fetch('https://api.anthropic.com/v1/messages', options);
  const code     = response.getResponseCode();
  const body     = response.getContentText();

  if (code !== 200) {
    console.error(`Claude API error ${code}: ${body.slice(0, 300)}`);
    return null;
  }

  const data = JSON.parse(body);
  const text = data.content?.[0]?.text || '';

  return Scorer_parseResponse(text, job);
}

/**
 * Extracts JSON from Claude's response text.
 * Claude is instructed to return only JSON but may occasionally wrap it.
 */
function Scorer_parseResponse(text, job) {
  // Strip markdown fences if present
  const cleaned = text.replace(/```json\s*/gi, '').replace(/```\s*/g, '').trim();

  // Find the first {...} block
  const match = cleaned.match(/\{[\s\S]*\}/);
  if (!match) {
    console.error(`No JSON found in Claude response for "${job.title}" at "${job.company}". Raw: ${text.slice(0, 200)}`);
    return null;
  }

  try {
    const parsed = JSON.parse(match[0]);
    // Basic shape validation
    if (typeof parsed.score !== 'number') {
      console.error(`Invalid score in Claude response for "${job.title}"`);
      return null;
    }
    return {
      score:            Math.min(100, Math.max(0, Math.round(parsed.score))),
      category:         parsed.category         || 'devrel',
      remote_confirmed: parsed.remote_confirmed || 'verify',
      resume_version:   parsed.resume_version   || 'A',
      top_keywords:     Array.isArray(parsed.top_keywords) ? parsed.top_keywords.slice(0, 3) : [],
      fit_summary:      parsed.fit_summary       || '',
      watch_out:        parsed.watch_out         || '',
    };
  } catch (e) {
    console.error(`JSON parse error for "${job.title}": ${e.message}`);
    return null;
  }
}

/**
 * Processes all rows with status='new', scores each one with Claude,
 * and writes the results back to the sheet.
 * Stops at CONFIG.MAX_SCORE_PER_RUN to stay within the 6-minute limit.
 */
function Scorer_runPendingScoring() {
  const pending = Sheet_getJobsToScore();

  if (pending.length === 0) {
    console.log('Scorer: no pending jobs to score.');
    return;
  }

  console.log(`Scorer: scoring ${pending.length} job(s)...`);
  let scored = 0;
  let failed = 0;

  for (const job of pending) {
    // Mark as 'scoring' immediately so a concurrent run doesn't double-process
    const sheet = Sheet_getOrCreate();
    sheet.getRange(job.rowIndex, COLS.STATUS).setValue('scoring');

    const scoreData = Scorer_scoreJob(job);

    if (scoreData) {
      Sheet_updateScore(job.rowIndex, scoreData);
      const flag = scoreData.score >= CONFIG.SCORE_THRESHOLD ? 'FLAGGED' : 'archived';
      console.log(`  [${flag}] ${job.title} @ ${job.company} — score: ${scoreData.score}`);
      scored++;
    } else {
      // Reset to 'new' so the next run retries it
      sheet.getRange(job.rowIndex, COLS.STATUS).setValue('new');
      failed++;
    }

    // Gentle pacing — stay well within rate limits
    Utilities.sleep(800);
  }

  console.log(`Scorer done: ${scored} scored, ${failed} failed.`);
}
