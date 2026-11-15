import { currentReadings, hasRecentAlertForZip, insertAlert, listActiveSubscriberZips } from '../db';
import { env } from '../env';
import type { AlertKind } from '../types';
import { ALERT_TEXT_COOLDOWN_HOURS, dispatchAlert } from './dispatch';

// Mode 3: alerts from our own readings, on top of NWS's. For every zip with a subscriber, the newest current
// reading (M2's readings table, last 3 hours) is checked against M4_ALERT_HEAT_INDEX_F (default 103°F, NWS's
// "danger" level) and M4_ALERT_AQI (default 101, unhealthy for sensitive groups). A zip over a line gets a
// high_heat_index / high_aqi alert, dispatched like any other: Messenger subscribers who wrote in the last 24 hours,
// the per-alert and cooldown guards. At most one alert per zip and kind every ALERT_TEXT_COOLDOWN_HOURS.

export interface ReadingCheckSummary {
  zipsChecked: number;
  alertsRaised: number;
  textsSent: number;
}

function reason(error: unknown): string {
  return error instanceof Error ? error.message : 'unknown error';
}

// Runs one check. Throws only when the subscriber zips or the readings cannot be read; one zip's failure never
// stops the others.
export async function checkReadingAlerts(): Promise<ReadingCheckSummary> {
  const zips = await listActiveSubscriberZips();
  const readings = await currentReadings(zips);
  const since = new Date(Date.now() - ALERT_TEXT_COOLDOWN_HOURS * 3600_000);
  const heatLine = env.heatIndexAlertF();
  const aqiLine = env.aqiAlert();
  let alertsRaised = 0;
  let textsSent = 0;

  for (const reading of readings) {
    const over: { kind: AlertKind; headline: string }[] = [];
    if (reading.heat_index != null && reading.heat_index >= heatLine) {
      over.push({ kind: 'high_heat_index', headline: `Heat index ${Math.round(reading.heat_index)}°F in ${reading.zip} (Shade reading alert)` });
    }
    if (reading.aqi != null && reading.aqi >= aqiLine) {
      over.push({ kind: 'high_aqi', headline: `AQI ${Math.round(reading.aqi)} in ${reading.zip} (Shade reading alert)` });
    }

    for (const { kind, headline } of over) {
      try {
        if (await hasRecentAlertForZip(kind, reading.zip, since)) continue;
        const alert = await insertAlert({ kind, nwsId: null, zips: [reading.zip], headline, onsetAt: new Date() });
        alertsRaised++;
        textsSent += (await dispatchAlert(alert)).textsSent;
      } catch (error) {
        console.error(`[m4] reading alert ${kind} for ${reading.zip} failed (${reason(error)})`);
      }
    }
  }
  return { zipsChecked: zips.length, alertsRaised, textsSent };
}
