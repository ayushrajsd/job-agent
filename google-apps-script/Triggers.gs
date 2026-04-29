// ─── TRIGGER MANAGEMENT ──────────────────────────────────────────────────────
// Run Triggers_setup() ONCE from the Apps Script editor after deployment.
// All times are UTC; 9 AM IST = 3:30 AM UTC.

/**
 * Creates all three time-based triggers.
 * Safe to run multiple times — removes existing job-agent triggers first.
 */
function Triggers_setup() {
  Triggers_teardown();

  // 1. Daily fetch — 3:30 AM UTC (= 9:00 AM IST)
  ScriptApp.newTrigger('runDailyFetch')
    .timeBased()
    .everyDays(1)
    .atHour(3)        // Apps Script atHour is UTC-based
    .nearMinute(30)
    .create();

  // 2. Hourly scoring — picks up any 'new' rows written by the daily fetch
  ScriptApp.newTrigger('runScoring')
    .timeBased()
    .everyHours(1)
    .create();

  // 3. Weekly digest — every Monday at 3:30 AM UTC (= 9:00 AM IST)
  ScriptApp.newTrigger('runDigest')
    .timeBased()
    .onWeekDay(ScriptApp.WeekDay.MONDAY)
    .atHour(3)
    .nearMinute(30)
    .create();

  console.log('Triggers created: runDailyFetch (daily 9 AM IST), runScoring (hourly), runDigest (Monday 9 AM IST)');
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
