import fetch from 'node-fetch';

interface SerpApiResult {
  title: string;
  link: string;
  snippet?: string;
  date?: string;
  displayed_link?: string;
}

interface SerpApiResponse {
  organic_results?: SerpApiResult[];
  error?: string;
}

export async function webSearch(query: string, numResults = 10): Promise<string> {
  const apiKey = process.env.SERPAPI_KEY;
  if (!apiKey) {
    throw new Error('SERPAPI_KEY is not set. Add it to your .env file.');
  }

  const params = new URLSearchParams({
    api_key: apiKey,
    q: query,
    num: String(numResults),
    engine: 'google',
    gl: 'us',
    hl: 'en',
  });

  const response = await fetch(`https://serpapi.com/search?${params}`, {
    headers: { 'User-Agent': 'job-agent/1.0' },
  });

  if (!response.ok) {
    throw new Error(`SerpApi HTTP error: ${response.status} ${response.statusText}`);
  }

  const data = (await response.json()) as SerpApiResponse;

  if (data.error) {
    throw new Error(`SerpApi error: ${data.error}`);
  }

  const results = data.organic_results ?? [];
  if (results.length === 0) {
    return 'No results found for this query.';
  }

  return results
    .slice(0, numResults)
    .map(
      (r, i) =>
        `[${i + 1}] ${r.title}\n` +
        `URL: ${r.link}\n` +
        (r.date ? `Date: ${r.date}\n` : '') +
        (r.snippet ? `Snippet: ${r.snippet}\n` : '')
    )
    .join('\n');
}
