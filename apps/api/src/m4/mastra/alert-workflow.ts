import { createStep, createWorkflow } from '@mastra/core/workflows';
import { z } from 'zod';
import { dispatchAlert, recordAlert } from '../alerts/dispatch';
import { fetchActiveAlerts, type NwsAlert } from '../alerts/nws';
import { requestRecrawl } from '../alerts/recrawl';
import type { AlertRow } from '../types';

// Runtime mirrors of NwsAlert and AlertRow for the step boundaries. `satisfies` breaks the build if they drift.
const nwsAlertSchema = z.object({
  id: z.string(),
  event: z.string(),
  headline: z.string().nullable(),
  onset: z.string().nullable(),
  expires: z.string().nullable(),
  zones: z.array(z.string()),
}) satisfies z.ZodType<NwsAlert>;

// Timestamps are ISO strings, as AlertRow declares. A row carrying Date objects fails validation between steps.
const alertRowSchema = z.object({
  id: z.number().int(),
  kind: z.enum(['extreme_heat_warning', 'heat_advisory', 'air_quality_alert', 'mock']),
  nws_id: z.string().nullable(),
  zips: z.array(z.string()),
  headline: z.string().nullable(),
  onset_at: z.string().nullable(),
  expires_at: z.string().nullable(),
  detected_at: z.string(),
  texts_sent: z.number().int(),
}) satisfies z.ZodType<AlertRow>;

const polledSchema = z.object({ alerts: z.array(nwsAlertSchema) });
const newAlertsSchema = z.object({ newAlerts: z.array(alertRowSchema) });
const summarySchema = z.object({ alertsDispatched: z.number().int(), textsSent: z.number().int() });

const pollNws = createStep({
  id: 'poll-nws',
  description: 'Fetch active heat and air quality alerts for San Diego County from NWS',
  inputSchema: z.object({}),
  outputSchema: polledSchema,
  execute: async () => ({ alerts: await fetchActiveAlerts() }),
});

const recordAlerts = createStep({
  id: 'record-alerts',
  description: 'Insert alerts not seen before (deduped by nws_id) and pass only the new ones on',
  inputSchema: polledSchema,
  outputSchema: newAlertsSchema,
  execute: async ({ inputData }) => {
    const newAlerts: AlertRow[] = [];
    for (const nwsAlert of inputData.alerts) {
      const { alert, isNew } = await recordAlert(nwsAlert);
      if (isNew) newAlerts.push(alert);
    }
    return { newAlerts };
  },
});

const recrawlSites = createStep({
  id: 'request-recrawl',
  description: 'Ask M2 to re-crawl sites in the affected zips before anyone is texted',
  inputSchema: newAlertsSchema,
  outputSchema: newAlertsSchema,
  execute: async ({ inputData }) => {
    const zips = [...new Set(inputData.newAlerts.flatMap((alert) => alert.zips))];
    if (zips.length > 0) await requestRecrawl(zips);
    return { newAlerts: inputData.newAlerts };
  },
});

const dispatchAlerts = createStep({
  id: 'dispatch-alerts',
  description: 'Text subscribers in the affected zips their nearest open site, once per alert',
  inputSchema: newAlertsSchema,
  outputSchema: summarySchema,
  execute: async ({ inputData }) => {
    let textsSent = 0;
    for (const alert of inputData.newAlerts) {
      textsSent += (await dispatchAlert(alert)).textsSent;
    }
    return { alertsDispatched: inputData.newAlerts.length, textsSent };
  },
});

// Register in src/mastra/index.ts as `workflows: { alertWorkflow }`.
//
// Scheduling (docs-workflows-scheduled-workflows.md): add a `schedule` field to the config below and the built-in
// scheduler picks the workflow up when Mastra boots, with no separate call. For a poll every five minutes:
//   schedule: { cron: '*/5 * * * *', timezone: 'America/Los_Angeles', inputData: {} },
// It is left off on purpose: a real heat alert would text every subscriber in the affected zips, so turn it on
// only once Twilio can send and the team agrees. Fires run in-process on a long-lived host and are best-effort: a
// missed tick is not replayed. To poll once by hand:
//   ./node_modules/.bin/mastra api --url http://127.0.0.1:4111 workflow run start alertWorkflow '{"inputData":{}}'
//
// TODO: only alerts that are new in this run reach dispatch. If request-recrawl or dispatch-alerts fails, the next
//       poll sees the alert as already recorded and never texts for it. Decide between step `retries` and
//       dispatching every still-active alert on each poll (dispatchAlert skips anyone already texted).
export const alertWorkflow = createWorkflow({
  id: 'alert-workflow',
  inputSchema: z.object({}),
  outputSchema: summarySchema,
})
  .then(pollNws)
  .then(recordAlerts)
  .then(recrawlSites)
  .then(dispatchAlerts)
  .commit();
