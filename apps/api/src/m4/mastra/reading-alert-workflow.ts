import { createStep, createWorkflow } from '@mastra/core/workflows';
import { z } from 'zod';
import { checkReadingAlerts } from '../alerts/readings';
import { env } from '../env';

// Mode 3 on a timer: checks current readings against the alert lines (alerts/readings.ts) and messages the zips
// over them. Registered in src/mastra/index.ts. Scheduled only when M4_READING_ALERT_CRON is set (e.g.
// "*/15 * * * *"), read when the app boots (docs-workflows-scheduled-workflows.md); otherwise it runs on demand,
// from POST /m4/alerts/check-readings or:
//   ./node_modules/.bin/mastra api --url http://127.0.0.1:4111 workflow run start readingAlertWorkflow '{"inputData":{}}'

const summarySchema = z.object({
  zipsChecked: z.number().int(),
  alertsRaised: z.number().int(),
  textsSent: z.number().int(),
});

const checkReadings = createStep({
  id: 'check-readings',
  description: 'Raise heat-index and AQI alerts for zips whose current reading crosses the alert line',
  inputSchema: z.object({}),
  outputSchema: summarySchema,
  execute: async () => checkReadingAlerts(),
});

const cron = env.readingAlertCron();

export const readingAlertWorkflow = createWorkflow({
  id: 'reading-alert-workflow',
  inputSchema: z.object({}),
  outputSchema: summarySchema,
  ...(cron ? { schedule: { cron, timezone: 'America/Los_Angeles', inputData: {} } } : {}),
})
  .then(checkReadings)
  .commit();
