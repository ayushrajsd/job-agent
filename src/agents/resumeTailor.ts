import Anthropic from '@anthropic-ai/sdk';
import { JobListing, TailoredOutput } from '../types';
import { RESUME_TAILOR_SYSTEM_PROMPT } from '../config/candidate';
import { info } from '../utils/logger';

function buildTailorMessage(job: JobListing, includeCoverNote: boolean): string {
  return `
Please tailor Ayush Raj's resume for the following job listing.
${includeCoverNote ? 'Include a cover note (COVER_NOTE=true).' : 'Do not include a cover note (COVER_NOTE=false).'}

JOB LISTING:
${JSON.stringify(job, null, 2)}

Follow all 7 steps in your instructions. Return your output using the four exact section
headers: ## MATCH ANALYSIS, ## RESUME CHANGES SUMMARY, ## TAILORED RESUME, ## COVER NOTE.
`.trim();
}

function parseTailoredOutput(raw: string, job: JobListing): TailoredOutput {
  const sections: Record<string, string> = {};
  const headers = [
    'MATCH ANALYSIS',
    'RESUME CHANGES SUMMARY',
    'TAILORED RESUME',
    'COVER NOTE',
  ];

  for (let i = 0; i < headers.length; i++) {
    const header = headers[i];
    const nextHeader = headers[i + 1];
    const startPattern = new RegExp(`##\\s*${header}`, 'i');
    const startMatch = raw.search(startPattern);
    if (startMatch === -1) continue;

    const contentStart = raw.indexOf('\n', startMatch) + 1;
    let contentEnd = raw.length;

    if (nextHeader) {
      const endPattern = new RegExp(`##\\s*${nextHeader}`, 'i');
      const endMatch = raw.search(endPattern);
      if (endMatch !== -1) contentEnd = endMatch;
    }

    sections[header] = raw.slice(contentStart, contentEnd).trim();
  }

  const coverNote = sections['COVER NOTE'];
  const hasRealCoverNote =
    coverNote && !coverNote.toLowerCase().includes('not requested');

  return {
    job,
    match_analysis: sections['MATCH ANALYSIS'] ?? '',
    changes_summary: sections['RESUME CHANGES SUMMARY'] ?? '',
    resume_markdown: sections['TAILORED RESUME'] ?? raw,
    cover_note: hasRealCoverNote ? coverNote : undefined,
  };
}

export async function runResumeTailor(
  client: Anthropic,
  model: string,
  job: JobListing,
  includeCoverNote = false
): Promise<TailoredOutput> {
  info(`Resume Tailor starting for: ${job.title} at ${job.company} (score: ${job.score})`);

  const response = await client.messages.create({
    model,
    max_tokens: 8192,
    system: [
      {
        type: 'text',
        text: RESUME_TAILOR_SYSTEM_PROMPT,
        cache_control: { type: 'ephemeral' },
      },
    ],
    messages: [
      {
        role: 'user',
        content: buildTailorMessage(job, includeCoverNote),
      },
    ],
  });

  const textBlock = response.content.find((b) => b.type === 'text');
  const rawText = textBlock && textBlock.type === 'text' ? textBlock.text : '';

  info(`Resume Tailor completed for: ${job.title} at ${job.company}`);
  return parseTailoredOutput(rawText, job);
}
