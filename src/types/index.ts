export type JobCategory = 'devrel' | 'ai-devrel' | 'edtech' | 'ai-eng' | 'ai-trainer';

export interface ScoreBreakdown {
  location: number;
  category: number;
  skills: number;
  company: number;
  recency: number;
}

export interface JobListing {
  rank: number;
  title: string;
  company: string;
  category: JobCategory;
  location: string;
  remote_eligible: boolean | 'verify';
  posted_date: string;
  apply_url: string;
  salary: string | null;
  score: number;
  score_breakdown: ScoreBreakdown;
  fit_summary: string;
  watch_out: string;
}

export interface TailoredOutput {
  job: JobListing;
  match_analysis: string;
  changes_summary: string;
  resume_markdown: string;
  cover_note?: string;
}

export interface RunResult {
  date: string;
  jobs: JobListing[];
  tailored: TailoredOutput[];
}

export interface ToolInput {
  [key: string]: unknown;
}

export interface SearchInput extends ToolInput {
  query: string;
  num_results?: number;
}

export interface FetchInput extends ToolInput {
  url: string;
}
