import fs from 'fs';
import path from 'path';
import Anthropic from '@anthropic-ai/sdk';
import { JobListing, TailoredOutput, RunResult } from './types';
import { runJobFinder } from './agents/jobFinder';
import { runResumeTailor } from './agents/resumeTailor';
import { info, warn, error } from './utils/logger';

const OUTPUT_DIR = path.resolve(process.cwd(), 'output');
const JOBS_DIR = path.join(OUTPUT_DIR, 'jobs');
const RESUMES_DIR = path.join(OUTPUT_DIR, 'resumes');

function ensureDirs(): void {
  [OUTPUT_DIR, JOBS_DIR, RESUMES_DIR].forEach((d) => {
    if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
  });
}

function todayStr(): string {
  return new Date().toISOString().split('T')[0];
}

function slug(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 60);
}

export function saveJobs(jobs: JobListing[]): string {
  ensureDirs();
  const date = todayStr();
  const filePath = path.join(JOBS_DIR, `${date}.json`);
  fs.writeFileSync(filePath, JSON.stringify({ date, jobs }, null, 2));
  info(`Saved ${jobs.length} jobs to ${filePath}`);
  return filePath;
}

export function saveResume(output: TailoredOutput): string {
  ensureDirs();
  const date = todayStr();
  const dayDir = path.join(RESUMES_DIR, date);
  if (!fs.existsSync(dayDir)) fs.mkdirSync(dayDir, { recursive: true });

  const fileName = `${slug(output.job.company)}_${slug(output.job.title)}.md`;
  const filePath = path.join(dayDir, fileName);

  const content = [
    `# ${output.job.title} at ${output.job.company}`,
    `**Score:** ${output.job.score}/100`,
    `**Apply:** ${output.job.apply_url}`,
    '',
    '---',
    '',
    '## MATCH ANALYSIS',
    '',
    output.match_analysis,
    '',
    '---',
    '',
    '## RESUME CHANGES SUMMARY',
    '',
    output.changes_summary,
    '',
    '---',
    '',
    '## TAILORED RESUME',
    '',
    output.resume_markdown,
    ...(output.cover_note
      ? ['', '---', '', '## COVER NOTE', '', output.cover_note]
      : []),
  ].join('\n');

  fs.writeFileSync(filePath, content);
  info(`Saved resume to ${filePath}`);
  return filePath;
}

export function loadLatestJobs(): JobListing[] | null {
  ensureDirs();
  const files = fs
    .readdirSync(JOBS_DIR)
    .filter((f) => f.endsWith('.json'))
    .sort()
    .reverse();

  if (files.length === 0) {
    warn('No saved job files found in output/jobs/');
    return null;
  }

  const latest = path.join(JOBS_DIR, files[0]);
  info(`Loading jobs from ${latest}`);
  const data = JSON.parse(fs.readFileSync(latest, 'utf-8')) as { jobs: JobListing[] };
  return data.jobs;
}

export function loadJobsFromFile(filePath: string): JobListing[] {
  const data = JSON.parse(fs.readFileSync(filePath, 'utf-8')) as { jobs: JobListing[] };
  return data.jobs;
}

export async function runFindPipeline(client: Anthropic, model: string): Promise<JobListing[]> {
  const jobs = await runJobFinder(client, model);

  if (jobs.length === 0) {
    warn('No qualifying job listings found this run.');
    return [];
  }

  saveJobs(jobs);
  printJobSummary(jobs);
  return jobs;
}

export async function runTailorPipeline(
  client: Anthropic,
  model: string,
  jobs: JobListing[],
  includeCoverNote: boolean
): Promise<TailoredOutput[]> {
  const results: TailoredOutput[] = [];

  for (const job of jobs) {
    try {
      const output = await runResumeTailor(client, model, job, includeCoverNote);
      saveResume(output);
      results.push(output);
    } catch (err) {
      error(
        `Resume tailor failed for ${job.title} at ${job.company}: ${
          err instanceof Error ? err.message : String(err)
        }`
      );
    }
  }

  return results;
}

export async function runFullPipeline(
  client: Anthropic,
  model: string,
  autoTailor: boolean,
  includeCoverNote: boolean
): Promise<RunResult> {
  info('=== Full pipeline starting ===');
  const jobs = await runFindPipeline(client, model);

  let tailored: TailoredOutput[] = [];

  if (jobs.length > 0 && autoTailor) {
    info(`AUTO_TAILOR=true. Tailoring resumes for all ${jobs.length} listings...`);
    tailored = await runTailorPipeline(client, model, jobs, includeCoverNote);
  } else if (jobs.length > 0) {
    info(
      'AUTO_TAILOR=false. Run "npm run tailor" to tailor resumes for specific listings.'
    );
  }

  info('=== Full pipeline complete ===');
  return { date: todayStr(), jobs, tailored };
}

export function printJobSummary(jobs: JobListing[]): void {
  console.log('\n' + '='.repeat(60));
  console.log(`JOB FINDER RESULTS — ${todayStr()}`);
  console.log('='.repeat(60));

  jobs.forEach((job, i) => {
    const remote =
      job.remote_eligible === true
        ? 'YES'
        : job.remote_eligible === false
        ? 'NO'
        : 'VERIFY';

    console.log(
      `\n[${i + 1}] ${job.title} at ${job.company} (score: ${job.score}/100)`
    );
    console.log(`    Category : ${job.category}`);
    console.log(`    Location : ${job.location} | Remote: ${remote}`);
    console.log(`    Posted   : ${job.posted_date}`);
    console.log(`    Apply    : ${job.apply_url}`);
    if (job.salary) console.log(`    Salary   : ${job.salary}`);
    console.log(`    Fit      : ${job.fit_summary}`);
    if (job.watch_out) console.log(`    Watch out: ${job.watch_out}`);
  });

  console.log('\n' + '='.repeat(60) + '\n');
}
