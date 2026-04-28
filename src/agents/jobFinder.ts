import Anthropic from '@anthropic-ai/sdk';
import { JobListing } from '../types';
import { JOB_FINDER_SYSTEM_PROMPT } from '../config/candidate';
import {
  runAgentLoop,
  STANDARD_TOOLS,
  STANDARD_EXECUTORS,
} from './agentLoop';
import { info, warn } from '../utils/logger';

const TODAY = new Date().toISOString().split('T')[0];

const FINDER_USER_MESSAGE = `
Today's date is ${TODAY}.

Run a fresh search for open job listings that match the candidate profile.
Search all the platforms listed in your instructions: nodesk.co, workingnomads.com,
startup.jobs, weworkremotely.com, wellfound.com, web3.career, himalayas.app, and the
direct career pages of target companies (JetBrains, SerpApi, Postman, Supabase,
Appwrite, Vercel, Hashnode, n8n, Mistral AI).

For each listing you find, fetch the full job description to verify remote eligibility
and extract complete details before scoring.

Return ONLY the final JSON array of up to 10 job listings. No prose, no explanation —
just the JSON array starting with [ and ending with ].
`.trim();

function extractJson(text: string): JobListing[] {
  const match = text.match(/\[[\s\S]*\]/);
  if (!match) {
    throw new Error('No JSON array found in agent response.');
  }
  try {
    const parsed = JSON.parse(match[0]);
    if (!Array.isArray(parsed)) {
      throw new Error('Parsed value is not an array.');
    }
    return parsed as JobListing[];
  } catch (err) {
    throw new Error(
      `Failed to parse JSON from agent response: ${err instanceof Error ? err.message : String(err)}`
    );
  }
}

export async function runJobFinder(
  client: Anthropic,
  model: string
): Promise<JobListing[]> {
  info('Job Finder Agent starting...');

  const rawOutput = await runAgentLoop({
    client,
    model,
    systemPrompt: JOB_FINDER_SYSTEM_PROMPT,
    userMessage: FINDER_USER_MESSAGE,
    tools: STANDARD_TOOLS,
    toolExecutors: STANDARD_EXECUTORS,
    maxIterations: 30,
  });

  info('Job Finder Agent completed. Parsing results...');

  let listings: JobListing[];
  try {
    listings = extractJson(rawOutput);
  } catch (err) {
    warn(`JSON extraction failed: ${err instanceof Error ? err.message : String(err)}`);
    warn('Raw output snippet: ' + rawOutput.slice(0, 500));
    return [];
  }

  const maxJobs = parseInt(process.env.MAX_JOBS ?? '10', 10);
  const filtered = listings
    .filter((j) => j.score >= 60)
    .sort((a, b) => b.score - a.score)
    .slice(0, maxJobs);

  info(`Job Finder found ${filtered.length} qualifying listings (score >= 60).`);
  return filtered;
}
