// ─── SHEET OPERATIONS ────────────────────────────────────────────────────────

/**
 * Returns the Jobs sheet, creating it with headers if it doesn't exist.
 */
function Sheet_getOrCreate() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(CONFIG.SHEET_NAME);

  if (!sheet) {
    sheet = ss.insertSheet(CONFIG.SHEET_NAME);
    const headerRange = sheet.getRange(1, 1, 1, SHEET_HEADERS.length);
    headerRange.setValues([SHEET_HEADERS]);
    headerRange.setFontWeight('bold');
    headerRange.setBackground('#f3f3f3');
    sheet.setFrozenRows(1);

    // Column widths for readability
    sheet.setColumnWidth(COLS.TITLE,       250);
    sheet.setColumnWidth(COLS.COMPANY,     150);
    sheet.setColumnWidth(COLS.APPLY_URL,   300);
    sheet.setColumnWidth(COLS.FIT_SUMMARY, 400);
    sheet.setColumnWidth(COLS.JD_TEXT,     50);  // keep narrow — it's a data store

    console.log('Created sheet: ' + CONFIG.SHEET_NAME);
  }

  return sheet;
}

/**
 * Returns a Set of all Apply URLs already in the sheet (for deduplication).
 */
function Sheet_getExistingUrls() {
  const sheet = Sheet_getOrCreate();
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return new Set();

  const urls = sheet
    .getRange(2, COLS.APPLY_URL, lastRow - 1, 1)
    .getValues()
    .flat()
    .filter(Boolean);

  return new Set(urls);
}

/**
 * Appends a new job row with status='new'.
 * jobData shape: { title, company, location, salary, applyUrl, source, postedDate, jdText }
 */
function Sheet_appendJob(jobData) {
  const sheet = Sheet_getOrCreate();
  const row = new Array(SHEET_HEADERS.length).fill('');

  row[COLS.DATE_FOUND   - 1] = new Date().toISOString().split('T')[0];
  row[COLS.TITLE        - 1] = jobData.title        || '';
  row[COLS.COMPANY      - 1] = jobData.company      || '';
  row[COLS.LOCATION     - 1] = jobData.location     || '';
  row[COLS.SALARY       - 1] = jobData.salary       || '';
  row[COLS.APPLY_URL    - 1] = jobData.applyUrl     || '';
  row[COLS.SOURCE       - 1] = jobData.source       || '';
  row[COLS.POSTED_DATE  - 1] = jobData.postedDate   || '';
  row[COLS.STATUS       - 1] = 'new';
  row[COLS.JD_TEXT      - 1] = (jobData.jdText || '').slice(0, 50000);

  sheet.appendRow(row);
}

/**
 * Returns rows (as objects) where status = 'new', up to CONFIG.MAX_SCORE_PER_RUN.
 * Each object includes { rowIndex, title, company, location, jdText }.
 */
function Sheet_getJobsToScore() {
  const sheet = Sheet_getOrCreate();
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return [];

  const data = sheet
    .getRange(2, 1, lastRow - 1, SHEET_HEADERS.length)
    .getValues();

  const pending = [];
  for (let i = 0; i < data.length; i++) {
    const row = data[i];
    if (row[COLS.STATUS - 1] === 'new') {
      pending.push({
        rowIndex: i + 2,  // 1-based sheet row (header is row 1)
        title:    row[COLS.TITLE    - 1],
        company:  row[COLS.COMPANY  - 1],
        location: row[COLS.LOCATION - 1],
        salary:   row[COLS.SALARY   - 1],
        applyUrl: row[COLS.APPLY_URL - 1],
        jdText:   row[COLS.JD_TEXT  - 1],
      });
    }
    if (pending.length >= CONFIG.MAX_SCORE_PER_RUN) break;
  }

  return pending;
}

/**
 * Writes Claude's scoring result back to a specific row.
 * scoreData shape: { score, category, remote_confirmed, resume_version,
 *                    top_keywords, fit_summary, watch_out }
 */
function Sheet_updateScore(rowIndex, scoreData) {
  const sheet = Sheet_getOrCreate();
  const status = scoreData.score >= CONFIG.SCORE_THRESHOLD ? 'flagged' : 'archived';

  sheet.getRange(rowIndex, COLS.SCORE           ).setValue(scoreData.score            || 0);
  sheet.getRange(rowIndex, COLS.CATEGORY        ).setValue(scoreData.category         || '');
  sheet.getRange(rowIndex, COLS.REMOTE_CONFIRMED).setValue(scoreData.remote_confirmed || '');
  sheet.getRange(rowIndex, COLS.RESUME_VERSION  ).setValue(scoreData.resume_version   || '');
  sheet.getRange(rowIndex, COLS.TOP_KEYWORDS    ).setValue((scoreData.top_keywords || []).join(', '));
  sheet.getRange(rowIndex, COLS.FIT_SUMMARY     ).setValue(scoreData.fit_summary      || '');
  sheet.getRange(rowIndex, COLS.WATCH_OUT       ).setValue(scoreData.watch_out        || '');
  sheet.getRange(rowIndex, COLS.STATUS          ).setValue(status);

  // Colour-code the row
  const numCols = SHEET_HEADERS.length;
  const rowRange = sheet.getRange(rowIndex, 1, 1, numCols);
  if (status === 'flagged') {
    rowRange.setBackground('#d9ead3');  // green
  } else {
    rowRange.setBackground('#f4f4f4');  // grey
  }
}

/**
 * Returns all flagged rows (status='flagged'), sorted by score descending.
 * Used by the digest.
 */
function Sheet_getFlaggedJobs() {
  const sheet = Sheet_getOrCreate();
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return [];

  const data = sheet
    .getRange(2, 1, lastRow - 1, SHEET_HEADERS.length)
    .getValues();

  const flagged = data
    .filter((row) => row[COLS.STATUS - 1] === 'flagged')
    .map((row) => ({
      title:          row[COLS.TITLE           - 1],
      company:        row[COLS.COMPANY         - 1],
      location:       row[COLS.LOCATION        - 1],
      salary:         row[COLS.SALARY          - 1],
      applyUrl:       row[COLS.APPLY_URL       - 1],
      source:         row[COLS.SOURCE          - 1],
      postedDate:     row[COLS.POSTED_DATE     - 1],
      score:          row[COLS.SCORE           - 1],
      category:       row[COLS.CATEGORY        - 1],
      remoteConfirmed:row[COLS.REMOTE_CONFIRMED - 1],
      resumeVersion:  row[COLS.RESUME_VERSION  - 1],
      topKeywords:    row[COLS.TOP_KEYWORDS    - 1],
      fitSummary:     row[COLS.FIT_SUMMARY     - 1],
      watchOut:       row[COLS.WATCH_OUT       - 1],
      dateFound:      row[COLS.DATE_FOUND      - 1],
    }))
    .sort((a, b) => Number(b.score) - Number(a.score));

  return flagged;
}

/**
 * Returns count of rows by status — useful for a quick dashboard check.
 */
function Sheet_getStatusCounts() {
  const sheet = Sheet_getOrCreate();
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return { new: 0, flagged: 0, archived: 0, applied: 0 };

  const statuses = sheet
    .getRange(2, COLS.STATUS, lastRow - 1, 1)
    .getValues()
    .flat();

  return statuses.reduce((acc, s) => {
    acc[s] = (acc[s] || 0) + 1;
    return acc;
  }, {});
}
