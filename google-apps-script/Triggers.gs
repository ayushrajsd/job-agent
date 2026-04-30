// ─── TRIGGER MANAGEMENT ──────────────────────────────────────────────────────
// Run Triggers_setup() ONCE from the Apps Script editor after deployment.
// All times are UTC. Apps Script fires daily triggers within a ~1 hour window
// of the specified hour, so atHour(3) fires between 3–4 AM UTC = 8:30–9:30 AM IST.
// Do NOT combine nearMinute() with everyDays() — it is unreliable and often
// causes the trigger to silently not register.

/**
 * Creates all three time-based triggers.
 * Safe to run multiple times — removes existing job-agent triggers first.
 */
function Triggers_setup() {
  Triggers_teardown();

  // 1. Daily fetch — fires between 3–4 AM UTC (= 8:30–9:30 AM IST)
  ScriptApp.newTrigger('runDailyFetch')
    .timeBased()
    .everyDays(1)
    .atHour(3)
    .create();

  // 2. Hourly scoring — picks up 'new' rows within an hour of the daily fetch
  ScriptApp.newTrigger('runScoring')
    .timeBased()
    .everyHours(1)
    .create();

  // 3. Weekly digest — every Monday between 3–4 AM UTC (= 8:30–9:30 AM IST)
  ScriptApp.newTrigger('runDigest')
    .timeBased()
    .onWeekDay(ScriptApp.WeekDay.MONDAY)
    .atHour(3)
    .create();

  console.log('Triggers created: runDailyFetch (daily ~9 AM IST), runScoring (hourly), runDigest (Monday ~9 AM IST)');
}

/**
 * Removes all triggers created by this project.
 * Useful when re-deploying or changing the schedule.
 */
function Triggers_teardown() {
  const triggers = ScriptApp.getProjectTriggers();
  const managed  = ['runDailyFetch', 'runScoring', 'runDigest'];

  for (const trigger of triggers) {
    if (managed.includes(trigger.getHandlerFunction())) {
      ScriptApp.deleteTrigger(trigger);
    }
  }

  console.log('Existing job-agent triggers removed.');
}

/**
 * Lists all active triggers — useful for debugging.
 */
function Triggers_list() {
  const triggers = ScriptApp.getProjectTriggers();
  for (const t of triggers) {
    console.log(`${t.getHandlerFunction()} — ${t.getEventType()} — ${t.getTriggerSourceId()}`);
  }
}
