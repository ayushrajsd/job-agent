import 'dotenv/config';
import { Command } from 'commander';
import Anthropic from '@anthropic-ai/sdk';
import {
  runFindPipeline,
  runTailorPipeline,
  runFullPipeline,
  loadLatestJobs,
  loadJobsFromFile,
  printJobSummary,
} from './orchestrator';
import { startScheduler } from './scheduler';
import { info, error } from './utils/logger';

function createClient(): Anthropic {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    console.error(
      'Error: ANTHROPIC_API_KEY is not set.\n' +
        'Copy .env.example to .env and add your API key.'
    );
    process.exit(1);
  }
  return new Anthropic({ apiKey });
}

function getModel(): string {
  return process.env.CLAUDE_MODEL ?? 'claude-sonnet-4-6';
}

const program = new Command();

program
  .name('job-agent')
  .description(
    'Agentic job finder and resume tailor for Ayush Raj\n\n' +
      'Commands:\n' +
      '  find      Search job boards and save qualifying listings\n' +
      '  tailor    Tailor resume(s) from the latest (or specified) jobs file\n' +
      '  run       Run the full pipeline: find + optionally tailor\n' +
      '  schedule  Start the daily scheduler (9 AM IST)'
  )
  .version('1.0.0');

program
  .command('find')
  .description('Run the Job Finder Agent and save results to output/jobs/YYYY-MM-DD.json')
  .action(async () => {
    const client = createClient();
    const model = getModel();
    info(`Using model: ${model}`);
    try {
      await runFindPipeline(client, model);
    } catch (err) {
      error(`Find failed: ${err instanceof Error ? err.message : String(err)}`);
      process.exit(1);
    }
  });

program
  .command('tailor')
  .description('Run the Resume Tailor Agent for job listings')
  .option('-f, --file <path>', 'Path to a specific jobs JSON file (default: latest in output/jobs/)')
  .option('-r, --rank <n>', 'Tailor only the job at rank N (1-indexed)', parseInt)
  .option('-a, --all', 'Tailor resumes for all jobs in the file (default: true if no --rank)')
  .option('--cover-note', 'Include a cover note in each tailored resume')
  .action(async (opts: { file?: string; rank?: number; all?: boolean; coverNote?: boolean }) => {
    const client = createClient();
    const model = getModel();
    info(`Using model: ${model}`);

    const jobs = opts.file ? loadJobsFromFile(opts.file) : loadLatestJobs();
    if (!jobs || jobs.length === 0) {
      console.error('No jobs found. Run "npm run find" first.');
      process.exit(1);
    }

    printJobSummary(jobs);

    let targets = jobs;
    if (opts.rank !== undefined) {
      const job = jobs.find((j) => j.rank === opts.rank);
      if (!job) {
        console.error(`No job with rank ${opts.rank} found. Available ranks: ${jobs.map((j) => j.rank).join(', ')}`);
        process.exit(1);
      }
      targets = [job];
    }

    const coverNote =
      opts.coverNote === true || process.env.COVER_NOTE === 'true';

    info(`Tailoring ${targets.length} resume(s). Cover note: ${coverNote}`);
    try {
      await runTailorPipeline(client, model, targets, coverNote);
      info('Tailoring complete. Resumes saved to output/resumes/YYYY-MM-DD/');
    } catch (err) {
      error(`Tailor failed: ${err instanceof Error ? err.message : String(err)}`);
      process.exit(1);
    }
  });

program
  .command('run')
  .description('Run the full pipeline: find jobs, then tailor if AUTO_TAILOR=true')
  .option('--auto-tailor', 'Immediately tailor resumes for all found jobs')
  .option('--cover-note', 'Include a cover note in each tailored resume')
  .action(async (opts: { autoTailor?: boolean; coverNote?: boolean }) => {
    const client = createClient();
    const model = getModel();
    info(`Using model: ${model}`);

    const autoTailor = opts.autoTailor === true || process.env.AUTO_TAILOR === 'true';
    const coverNote = opts.coverNote === true || process.env.COVER_NOTE === 'true';

    info(`AUTO_TAILOR=${autoTailor} | COVER_NOTE=${coverNote}`);
    try {
      await runFullPipeline(client, model, autoTailor, coverNote);
    } catch (err) {
      error(`Run failed: ${err instanceof Error ? err.message : String(err)}`);
      process.exit(1);
    }
  });

program
  .command('schedule')
  .description('Start the daily scheduler (runs at 9:00 AM IST every day)')
  .action(() => {
    const client = createClient();
    const model = getModel();
    info(`Using model: ${model}`);
    startScheduler(client, model);
  });

program.parse(process.argv);

if (process.argv.length <= 2) {
  program.help();
}
