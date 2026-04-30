// ─── DATA SOURCES ─────────────────────────────────────────────────────────────

/**
 * Master fetch function. Pulls from all sources and returns a deduplicated
 * array of job objects ready to be written to the sheet.
 */
function Sources_fetchAll() {
  const existingUrls = Sheet_getExistingUrls();
  const allJobs = [];

  // 1. RSS feeds
  for (const feed of CONFIG.RSS_FEEDS) {
    try {
      const jobs = Sources_fetchRss(feed);
      allJobs.push(...jobs);
      console.log(`RSS [${feed.name}]: ${jobs.length} listings`);
    } catch (e) {
      console.error(`RSS [${feed.name}] failed: ${e.message}`);
    }
  }

  // 2. SerpApi — Google Jobs
  if (CONFIG.SERPAPI_KEY) {
    for (const query of CONFIG.SERPAPI_QUERIES) {
      try {
        const jobs = Sources_fetchSerpApi(query);
        allJobs.push(...jobs);
        console.log(`SerpApi ["${query}"]: ${jobs.length} listings`);
        Utilities.sleep(500); // gentle pacing between queries
      } catch (e) {
        console.error(`SerpApi ["${query}"] failed: ${e.message}`);
      }
    }
  } else {
    console.warn('SERPAPI_KEY not set — skipping Google Jobs.');
  }

  // 3. Adzuna
  if (CONFIG.ADZUNA_APP_ID && CONFIG.ADZUNA_APP_KEY) {
    for (const query of CONFIG.ADZUNA_QUERIES) {
      try {
        const jobs = Sources_fetchAdzuna(query.what, query.where);
        allJobs.push(...jobs);
        console.log(`Adzuna ["${query.what}"]: ${jobs.length} listings`);
        Utilities.sleep(300);
      } catch (e) {
        console.error(`Adzuna ["${query.what}"] failed: ${e.message}`);
      }
    }
  } else {
    console.warn('ADZUNA_APP_ID/KEY not set — skipping Adzuna.');
  }

  // Step 1 — keyword pre-filter (no API cost, runs before dedup)
  const keywordFiltered = allJobs.filter(Sources_isRelevant);
  console.log(`Sources_fetchAll: ${allJobs.length} raw → ${keywordFiltered.length} after keyword filter`);

  // Step 2 — deduplicate against existing sheet URLs and within this batch
  const seen = new Set(existingUrls);
  const newJobs = [];
  for (const job of keywordFiltered) {
    const url = (job.applyUrl || '').trim();
    if (url && !seen.has(url)) {
      seen.add(url);
      newJobs.push(job);
    }
  }

  console.log(`Sources_fetchAll: ${keywordFiltered.length} keyword-matched → ${newJobs.length} new after dedup`);
  return newJobs;
}

// ─── SERPAPI — GOOGLE JOBS ────────────────────────────────────────────────────

function Sources_fetchSerpApi(query) {
  const params = {
    engine:  'google_jobs',
    q:       query,
    hl:      'en',
    api_key: CONFIG.SERPAPI_KEY,
  };

  const url = 'https://serpapi.com/search?' + Sources_buildQueryString(params);
  const response = UrlFetchApp.fetch(url, { muteHttpExceptions: true });

  if (response.getResponseCode() !== 200) {
    throw new Error(`HTTP ${response.getResponseCode()}: ${response.getContentText().slice(0, 200)}`);
  }

  const data = JSON.parse(response.getContentText());
  const results = data.jobs_results || [];

  return results.map((r) => {
    const ext = r.detected_extensions || {};
    const salary = [ext.salary, ext.salary_min && ext.salary_max ? `${ext.salary_min}–${ext.salary_max}` : null]
      .filter(Boolean)[0] || '';

    return {
      title:      r.title        || '',
      company:    r.company_name || '',
      location:   r.location     || '',
      salary,
      applyUrl:   r.share_link   || r.job_link || r.related_links?.[0]?.link || '',
      source:     'serpapi-google-jobs',
      postedDate: Sources_parsePostedAt(ext.posted_at || ''),
      jdText:     Sources_stripHtml(r.description || ''),
    };
  }).filter((j) => j.applyUrl);
}

// ─── ADZUNA ───────────────────────────────────────────────────────────────────

function Sources_fetchAdzuna(what, where) {
  // Using 'us' endpoint — widest English-language DevRel coverage
  const params = {
    app_id:             CONFIG.ADZUNA_APP_ID,
    app_key:            CONFIG.ADZUNA_APP_KEY,
    results_per_page:   '50',
    what:               what,
    where:              where,
    'content-type':     'application/json',
  };

  const url = 'https://api.adzuna.com/v1/api/jobs/us/search/1?' + Sources_buildQueryString(params);
  const response = UrlFetchApp.fetch(url, { muteHttpExceptions: true });

  if (response.getResponseCode() !== 200) {
    throw new Error(`HTTP ${response.getResponseCode()}: ${response.getContentText().slice(0, 200)}`);
  }

  const data = JSON.parse(response.getContentText());
  const results = data.results || [];

  return results.map((r) => {
    const salaryParts = [r.salary_min, r.salary_max].filter(Boolean);
    const salary = salaryParts.length === 2
      ? `$${Math.round(r.salary_min / 1000)}k–$${Math.round(r.salary_max / 1000)}k`
      : salaryParts.length === 1 ? `$${Math.round(salaryParts[0] / 1000)}k` : '';

    return {
      title:      r.title                          || '',
      company:    r.company?.display_name          || '',
      location:   r.location?.display_name         || '',
      salary,
      applyUrl:   r.redirect_url                   || '',
      source:     'adzuna',
      postedDate: r.created ? r.created.split('T')[0] : '',
      jdText:     Sources_stripHtml(r.description || ''),
    };
  }).filter((j) => j.applyUrl);
}

// ─── RSS / ATOM FEED PARSER ───────────────────────────────────────────────────

function Sources_fetchRss(feed) {
  const response = UrlFetchApp.fetch(feed.url, {
    muteHttpExceptions: true,
    headers: { 'User-Agent': 'job-agent/1.0' },
  });

  if (response.getResponseCode() !== 200) {
    throw new Error(`HTTP ${response.getResponseCode()}`);
  }

  const xmlText = response.getContentText();
  return Sources_parseXml(xmlText, feed.name);
}

function Sources_parseXml(xmlText, sourceName) {
  const doc  = XmlService.parse(xmlText);
  const root = doc.getRootElement();

  if (root.getName() === 'feed') {
    return Sources_parseAtom(root, sourceName);
  }
  return Sources_parseRss2(root, sourceName);
}

function Sources_parseAtom(root, sourceName) {
  const ns      = XmlService.getNamespace('http://www.w3.org/2005/Atom');
  const entries = root.getChildren('entry', ns);
  const jobs    = [];

  for (const entry of entries) {
    const linkEl  = entry.getChild('link', ns);
    const url     = linkEl
      ? (linkEl.getAttribute('href') ? linkEl.getAttribute('href').getValue() : linkEl.getText())
      : '';
    if (!url) continue;

    const title   = entry.getChildText('title',   ns) || '';
    const summary = entry.getChildText('summary', ns) || entry.getChildText('content', ns) || '';
    const pub     = entry.getChildText('published', ns) || entry.getChildText('updated', ns) || '';

    jobs.push(Sources_buildJob({ title, url, description: summary, postedDate: pub, sourceName }));
  }

  return jobs;
}

function Sources_parseRss2(root, sourceName) {
  const channel = root.getChild('channel');
  if (!channel) return [];

  const items = channel.getChildren('item');
  const jobs  = [];

  for (const item of items) {
    const url = item.getChildText('link') || '';
    if (!url) continue;

    const title       = item.getChildText('title')       || '';
    const description = item.getChildText('description') || '';
    const pubDate     = item.getChildText('pubDate')     || '';

    jobs.push(Sources_buildJob({ title, url, description, postedDate: pubDate, sourceName }));
  }

  return jobs;
}

/**
 * Normalises a raw RSS item into the job shape expected by Sheet_appendJob.
 * Tries to split "Title at Company" patterns common in job board RSS feeds.
 */
function Sources_buildJob({ title, url, description, postedDate, sourceName }) {
  let jobTitle  = title.trim();
  let company   = '';

  // Many job RSS feeds format titles as "Role at Company" or "Role - Company"
  const atMatch = title.match(/^(.+?)\s+at\s+(.+)$/i);
  const dashMatch = !atMatch && title.match(/^(.+?)\s+[-–]\s+(.+)$/);
  if (atMatch) {
    jobTitle = atMatch[1].trim();
    company  = atMatch[2].trim();
  } else if (dashMatch) {
    jobTitle = dashMatch[1].trim();
    company  = dashMatch[2].trim();
  }

  // Normalise posted date
  let parsedDate = '';
  if (postedDate) {
    try {
      parsedDate = new Date(postedDate).toISOString().split('T')[0];
    } catch (_) {
      parsedDate = postedDate.slice(0, 10);
    }
  }

  return {
    title:      jobTitle,
    company,
    location:   'Remote',   // RSS feeds rarely include a structured location field
    salary:     '',
    applyUrl:   url,
    source:     sourceName,
    postedDate: parsedDate,
    jdText:     Sources_stripHtml(description),
  };
}

// ─── HELPERS ──────────────────────────────────────────────────────────────────

function Sources_stripHtml(html) {
  return (html || '')
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<\/li>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g,  '&')
    .replace(/&lt;/g,   '<')
    .replace(/&gt;/g,   '>')
    .replace(/&nbsp;/g, ' ')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g,  "'")
    .replace(/\s{3,}/g, '\n\n')
    .trim()
    .slice(0, 4000); // keep it within Claude's useful range
}

/**
 * Returns true if the job title or JD contains at least one keyword from FILTER_KEYWORDS.
 * This is the pre-Claude gate — cheap string matching, no API calls.
 */
function Sources_isRelevant(job) {
  const haystack = `${job.title} ${job.jdText}`.toLowerCase();
  return FILTER_KEYWORDS.some((kw) => haystack.includes(kw));
}

function Sources_buildQueryString(params) {
  return Object.entries(params)
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join('&');
}

/**
 * Converts "3 days ago", "2 weeks ago" → ISO date string.
 * Falls back to today's date if the string can't be parsed.
 */
function Sources_parsePostedAt(text) {
  if (!text) return new Date().toISOString().split('T')[0];

  const now = new Date();
  const match = text.match(/(\d+)\s+(hour|day|week|month)/i);
  if (!match) return now.toISOString().split('T')[0];

  const n    = parseInt(match[1], 10);
  const unit = match[2].toLowerCase();
  const ms   = { hour: 3.6e6, day: 864e5, week: 6.048e8, month: 2.628e9 }[unit] || 0;

  return new Date(now.getTime() - n * ms).toISOString().split('T')[0];
}
