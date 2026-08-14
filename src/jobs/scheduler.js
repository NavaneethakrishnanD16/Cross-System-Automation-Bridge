import cron from 'node-cron';
import { env } from '../config/env.js';
import { runBridgeCycle } from '../services/bridgeService.js';

export function startBridgeScheduler() {
  if (!cron.validate(env.bridgeCronSchedule)) {
    throw new Error(`Invalid BRIDGE_CRON_SCHEDULE: "${env.bridgeCronSchedule}"`);
  }

  cron.schedule(env.bridgeCronSchedule, async () => {
    try {
      const result = await runBridgeCycle();
      console.log(
        `[bridge] run complete — checked ${result.eventsChecked}, ` +
          `created ${result.ticketsCreated} tickets, ` +
          `skipped ${result.skippedDuplicates} duplicates`
      );
    } catch (err) {
      console.error('[bridge] scheduled run failed:', err.message);
    }
  });

  console.log(`[bridge] scheduler started with cron "${env.bridgeCronSchedule}"`);
}