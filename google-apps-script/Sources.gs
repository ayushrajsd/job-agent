// ─── DATA SOURCES ─────────────────────────────────────────────────────────────

/**
 * Master fetch. Pulls from all four sources, runs pre-filters, deduplicates,
 * and returns only new jobs ready to be written to the sheet.
 *
 * Filter chain (all zero API cost):
 *   raw → negative title filter → location reject → keyword filter → dedup
 */
function Sources_fetchAll() {
  const existingUrls = Sheet_getExistingUrls();
  const allJobs = [];

  // ── 1. Remotive (best quality — all jobs are genuinely remote) ────────────
  for (const s of CONFIG.REMOTIVE_SEARCHES) {
    try {
      const jobs = Sources_fetchRemotive(s.category, s.search);
      allJobs.push(...jobs);
      console.log(`Remotive [${s.category}${s.search ? ' / ' + s.search : ''}]: ${jobs.length}`);
    } catch (e) {
      console.error(`Remotive [${s.category}] failed: ${e.message}`);
    }
    Utilities.sleep(300);
  }

  // ── 2. RSS feeds ──────────────────────────────────────────────────────────
  for (const feed of CONFIG.RSS_FEEDS) {
    try {
      const jobs = Sources_fetchRss(feed);
      allJobs.push(...jobs);
      console.log(`RSS [${feed.name}]: ${jobs.length}`);
    } catch (e) {
      console.error(`RSS [${feed.name}] failed: ${e.message}`);
    }
  }

  // ── 3. SerpApi — Google Jobs ──────────────────────────────────────────────
  if (CONFIG.SERPAPI_KEY) {
    for (const query of CONFIG.SERPAPI_QUERIES) {
      try {
        const jobs = Sources_fetchSerpApi(query);
        allJobs.push(...jobs);
        console.log(`SerpApi ["${query}"]: ${jobs.length}`);
        Utilities.sleep(600);
      } catch (e) {
        console.error(`SerpApi ["${query}"] failed: ${e.message}`);
      }
    }
  } else {
    console.warn('SERPAPI_KEY not set.');
  }

  // ── 4. Adzuna ─────────────────────────────────────────────────────────────
  if (CONFIG.ADZUNA_APP_ID && CONFIG.ADZUNA_APP_KEY) {
    for (const q of CONFIG.ADZUNA_QUERIES) {
      try {
        const jobs = Sources_fetchAdzuna(q.what, q.endpoint);
        allJobs.push(...jobs);
        console.log(`Adzuna ["${q.what}" / ${q.endpoint}]: ${jobs.length}`);
        Utilities.sleep(300);
      } catch (e) {
        console.error(`Adzuna ["${q.what}"] failed: ${e.message}`);
      }
    }
  } else {
    console.warn('ADZUNA keys not set.');
  }

  console.log(`Total raw: ${allJobs.length}`);

  // ── Filter chain ──────────────────────────────────────────────────────────

  // 1. Reject bad job titles (web3, mandarin, non-technical, etc.)
  const titleFiltered = allJobs.filter((j) => !Sources_hasBadTitle(j));
  console.log(`After negative title filter: ${titleFiltered.length}`);

  // 2. Reject US-only / geo-restricted by JD text
  const locationFiltered = titleFiltered.filter(Sources_isLocationEligible);
  console.log(`After location filter: ${locationFiltered.length}`);

  // 3. Must match at least one positive keyword
  const keywordFiltered = locationFiltered.filter(Sources_isRelevant);
  console.log(`After keyword filter: ${keywordFiltered.length}`);

  // 4. Deduplicate against sheet + within this batch
  const seen = new Set(existingUrls);
  const newJobs = [];
  for (const job of keywordFiltered) {
    const url = (job.applyUrl || '').trim();
    if (url && !seen.has(url)) {
      seen.add(url);
      newJobs.push(job);
    }
  }

  console.log(`New jobs to write: ${newJobs.length}`);
  return newJobs;
}

// ─── SOURCE: REMOTIVE ─────────────────────────────────────────────────────────

function Sources_fetchRemotive(category, search) {
  const params = { limit: '50' };
  if (category) params.category = category;
  if (search)   params.search   = search;

  const url = 'https://remotive.com/api/remote-jobs?' + Sources_buildQueryString(params);
  const response = UrlFetchApp.fetch(url, {
    muteHttpExceptions: true,
    headers: { 'User-Agent': 'job-agent/1.0' },
  });

  if (response.getResponseCode() !== 200) {
    throw new Error(`HTTP ${response.getResponseCode()}`);
  }

  const data = JSON.parse(response.getContentText());
  const jobs = data.jobs || [];

  return jobs.map((r) => ({
    title:                    r.title              || '',
    company:                  r.company_name       || '',
    location:                 r.candidate_required_location || 'Worldwide',
    salary:                   r.salary             || '',
    applyUrl:                 r.url                || '',
    source:                   'remotive',
    postedDate:               r.publication_date ? r.publication_date.split('T')[0] : '',
    jdText:                   Sources_stripHtml(r.description || ''),
    // Carry the structured location field for the eligibility check below
    candidateRequiredLocation: r.candidate_required_location || '',
  })).filter((j) => j.applyUrl);
}

// ─── SOURCE: SERPAPI — GOOGLE JOBS ───────────────────────────────────────────

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

  const data    = JSON.parse(response.getContentText());
  const results = data.jobs_results || [];

  return results.map((r) => {
    const ext    = r.detected_extensions || {};
    const salary = ext.salary || '';

    return {
      title:      r.title        || '',
      company:    r.company_name || '',
      location:   r.location     || '',
      salary,
      applyUrl:   r.share_link   || r.job_link || (r.related_links || [])[0]?.link || '',
      source:     'serpapi',
      postedDate: Sources_parsePostedAt(ext.posted_at || ''),
      jdText:     Sources_stripHtml(r.description || ''),
      candidateRequiredLocation: '',  // SerpApi doesn't have this field
    };
  }).filter((j) => j.applyUrl);
}

// ─── SOURCE: ADZUNA ───────────────────────────────────────────────────────────

function Sources_fetchAdzuna(what, endpoint) {
  const ep = endpoint || 'us';
  const params = {
    app_id:           CONFIG.ADZUNA_APP_ID,
    app_key:          CONFIG.ADZUNA_APP_KEY,
    results_per_page: '50',
    what,
    where:            'remote',
    'content-type':   'application/json',
  };

  const url = `https://api.adzuna.com/v1/api/jobs/${ep}/search/1?` + Sources_buildQueryString(params);
  const response = UrlFetchApp.fetch(url, { muteHttpExceptions: true });

  if (response.getResponseCode() !== 200) {
    throw new Error(`HTTP ${response.getResponseCode()}: ${response.getContentText().slice(0, 200)}`);
  }

  const data    = JSON.parse(response.getContentText());
  const results = data.results || [];

  return results.map((r) => {
    const salaryParts = [r.salary_min, r.salary_max].filter(Boolean);
    const salary = salaryParts.length === 2
      ? `$${Math.round(r.salary_min / 1000)}k–$${Math.round(r.salary_max / 1000)}k`
      : '';

    return {
      title:      r.title                 || '',
      company:    r.company?.display_name || '',
      location:   r.location?.display_name || '',
      salary,
      applyUrl:   r.redirect_url          || '',
      source:     `adzuna-${ep}`,
      postedDate: r.created ? r.created.split('T')[0] : '',
      jdText:     Sources_stripHtml(r.description || ''),
      candidateRequiredLocation: '',
    };
  }).filter((j) => j.applyUrl);
}

// ─── SOURCE: RSS / ATOM ───────────────────────────────────────────────────────

function Sources_fetchRss(feed) {
  const response = UrlFetchApp.fetch(feed.url, {
    muteHttpExceptions: true,
    headers: { 'User-Agent': 'job-agent/1.0' },
  });

  if (response.getResponseCode() !== 200) {
    throw new Error(`HTTP ${response.getResponseCode()}`);
  }

  return Sources_parseXml(response.getContentText(), feed.name);
}

function Sources_parseXml(xmlText, sourceName) {
  const doc  = XmlService.parse(xmlText);
  const root = doc.getRootElement();
  return root.getName() === 'feed'
    ? Sources_parseAtom(root, sourceName)
    : Sources_parseRss2(root, sourceName);
}

function Sources_parseAtom(root, sourceName) {
  const ns      = XmlService.getNamespace('http://www.w3.org/2005/Atom');
  const entries = root.getChildren('entry', ns);
  const jobs    = [];

  for (const entry of entries) {
    const linkEl = entry.getChild('link', ns);
    const url    = linkEl
      ? (linkEl.getAttribute('href') ? linkEl.getAttribute('href').getValue() : linkEl.getText())
      : '';
    if (!url) continue;

    jobs.push(Sources_buildRssJob({
      title:       entry.getChildText('title',   ns) || '',
      url,
      description: entry.getChildText('summary', ns) || entry.getChildText('content', ns) || '',
      postedDate:  entry.getChildText('published', ns) || entry.getChildText('updated', ns) || '',
      sourceName,
    }));
  }
  return jobs;
}

function Sources_parseRss2(root, sourceName) {
  const channel = root.getChild('channel');
  if (!channel) return [];

  return channel.getChildren('item')
    .filter((item) => item.getChildText('link'))
    .map((item) => Sources_buildRssJob({
      title:       item.getChildText('title')       || '',
      url:         item.getChildText('link')        || '',
      description: item.getChildText('description') || '',
      postedDate:  item.getChildText('pubDate')     || '',
      sourceName,
    }));
}

function Sources_buildRssJob({ title, url, description, postedDate, sourceName }) {
  let jobTitle = title.trim();
  let company  = '';

  const atMatch   = title.match(/^(.+?)\s+at\s+(.+)$/i);
  const dashMatch = !atMatch && title.match(/^(.+?)\s+[-–]\s+(.+)$/);
  if (atMatch)        { jobTitle = atMatch[1].trim();   company = atMatch[2].trim(); }
  else if (dashMatch) { jobTitle = dashMatch[1].trim(); company = dashMatch[2].trim(); }

  let parsedDate = '';
  if (postedDate) {
    try { parsedDate = new Date(postedDate).toISOString().split('T')[0]; }
    catch (_) { parsedDate = postedDate.slice(0, 10); }
  }

  return {
    title:      jobTitle,
    company,
    location:   'Remote',
    salary:     '',
    applyUrl:   url,
    source:     sourceName,
    postedDate: parsedDate,
    jdText:     Sources_stripHtml(description),
    candidateRequiredLocation: '',
  };
}

// ─── FILTERS ──────────────────────────────────────────────────────────────────

/**
 * Returns true if the job TITLE contains a negative title keyword.
 * Checks title only — keeps precision, avoids over-rejecting on JD text.
 */
function Sources_hasBadTitle(job) {
  const title = (job.title || '').toLowerCase();
  return NEGATIVE_TITLE_KEYWORDS.some((kw) => title.includes(kw));
}

/**
 * Returns false if the job JD explicitly requires US work authorization
 * or the structured location field is a hard geo-restriction.
 * Returns true = eligible (pass to next filter; Claude does final evaluation).
 */
function Sources_isLocationEligible(job) {
  // Remotive: use the structured field when available
  if (job.candidateRequiredLocation) {
    const loc = job.candidateRequiredLocation.toLowerCase();
    const isRestricted = /\b(usa?|united states|us only|canada|uk|united kingdom|europe only|eu only|germany|france|australia only)\b/.test(loc);
    const isWorldwide  = /worldwide|global|anywhere|remote ok|india|apac|international/.test(loc);
    if (isRestricted && !isWorldwide) return false;
  }

  // All sources: scan JD text for hard US-authorization language
  const jd = (job.jdText || '').toLowerCase();
  if (LOCATION_REJECT_PATTERNS.some((p) => jd.includes(p))) return false;

  return true;
}

/**
 * Returns true if title OR JD text contains at least one positive keyword.
 */
function Sources_isRelevant(job) {
  const haystack = `${job.title} ${job.jdText}`.toLowerCase();
  return FILTER_KEYWORDS.some((kw) => haystack.includes(kw));
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
    .replace(/&amp;/g,  '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/\s{3,}/g, '\n\n')
    .trim()
    .slice(0, 4000);
}

function Sources_buildQueryString(params) {
  return Object.entries(params)
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join('&');
}

function Sources_parsePostedAt(text) {
  if (!text) return new Date().toISOString().split('T')[0];
  const now   = new Date();
  const match = text.match(/(\d+)\s+(hour|day|week|month)/i);
  if (!match) return now.toISOString().split('T')[0];
  const n  = parseInt(match[1], 10);
  const ms = { hour: 3.6e6, day: 864e5, week: 6.048e8, month: 2.628e9 }[match[2].toLowerCase()] || 0;
  return new Date(now.getTime() - n * ms).toISOString().split('T')[0];
}
