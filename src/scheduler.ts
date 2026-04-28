import cron from 'node-cron';
import Anthropic from '@anthropic-ai/sdk';
import { runFullPipeline } from './orchestrator';
import { info, error } from './utils/logger';

// 9:00 AM IST = 3:30 AM UTC => cron: "30 3 * * *"
const SCHEDULE_IST_9AM = '30 3 * * *';

export function startScheduler(client: Anthropic, model: string): void {
  const autoTailor = process.env.AUTO_TAILOR === 'true';
  const coverNote = process.env.COVER_NOTE === 'true';

  info(`Scheduler starting. Will run daily at 9:00 AM IST (cron: ${SCHEDULE_IST_9AM})`);
  info(`AUTO_TAILOR=${autoTailor} | COVER_NOTE=${coverNote}`);

  cron.schedule(
    SCHEDULE_IST_9AM,
    async () => {
      info('Scheduled run triggered.');
      try {
        await runFullPipeline(client, model, autoTailor, coverNote);
      } catch (err) {
        error(
          `Scheduled run failed: ${err instanceof Error ? err.message : String(err)}`
        );
      }
    },
    { timezone: 'UTC' }
  );

  info('Scheduler is running. Press Ctrl+C to stop.');
}
