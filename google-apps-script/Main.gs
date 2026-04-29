// ─── ENTRY POINTS ─────────────────────────────────────────────────────────────
// These are the functions called by triggers and by you when running manually.
// Each function is self-contained and safe to run from the editor at any time.

/**
 * DAILY — fetches all sources, deduplicates, and writes new rows to the sheet.
 * Triggered at 9 AM IST (3:30 AM UTC) every day.
 */
function runDailyFetch() {
  console.log('=== runDailyFetch started ===');
  const startMs = Date.now();

  try {
    const newJobs = Sources_fetchAll();

    if (newJobs.length === 0) {
      console.log('No new jobs found today.');
    } else {
      for (const job of newJobs) {
        Sheet_appendJob(job);
      }
      console.log(`Written ${newJobs.length} new job(s) to sheet.`);
    }
  } catch (e) {
    console.error('runDailyFetch error: ' + e.message);
  }

  console.log(`=== runDailyFetch done in ${Math.round((Date.now() - startMs) / 1000)}s ===`);
}

/**
 * HOURLY — scores all rows with status='new' using Claude Haiku.
 * Triggered every hour so there's no long wait between fetch and scoring.
 */
function runScoring() {
  console.log('=== runScoring started ===');
  const startMs = Date.now();

  try {
    Scorer_runPendingScoring();
  } catch (e) {
    console.error('runScoring error: ' + e.message);
  }

  console.log(`=== runScoring done in ${Math.round((Date.now() - startMs) / 1000)}s ===`);
}

/**
 * WEEKLY — sends the HTML digest email of all flagged jobs.
 * Triggered every Monday at 9 AM IST.
 */
function runDigest() {
  console.log('=== runDigest started ===');

  try {
    Digest_sendWeekly();
  } catch (e) {
    console.error('runDigest error: ' + e.message);
  }

  console.log('=== runDigest done ===');
}

/**
 * MANUAL — run the full pipeline in sequence.
 * Use this to test everything end-to-end from the editor.
 */
function runAll() {
  runDailyFetch();
  runScoring();
  // digest is weekly — only run manually when you want to preview it
  // runDigest();
}

/**
 * MANUAL — print a quick status summary to the Apps Script log.
 */
function runStatus() {
  const counts = Sheet_getStatusCounts();
  console.log('Sheet status counts:');
  console.log(JSON.stringify(counts, null, 2));
}

/**
 * SETUP — call this once after pasting the scripts into Apps Script.
 * Creates the sheet structure and registers all time-based triggers.
 */
function runSetup() {
  Sheet_getOrCreate();     // creates sheet + headers if missing
  Triggers_setup();        // registers daily / hourly / weekly triggers
  console.log('Setup complete. Sheet ready. Triggers registered.');
  console.log('Next step: add your API keys in Project Settings > Script Properties.');
}
