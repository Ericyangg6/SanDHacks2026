import { env } from '../env';
import { notImplemented } from '../todo';
import type { AlertKind } from '../types';
import { SD_COUNTY_ZONES } from './zones';

export interface NwsAlert {
  id: string; // NWS alert id, stored as alerts.nws_id
  event: string; // e.g. "Heat Advisory"
  headline: string | null;
  onset: string | null; // ISO
  expires: string | null; // ISO
  zones: string[]; // UGC zone codes
}

// Exact NWS event names (GET https://api.weather.gov/alerts/types) and the alert_kind each one maps to.
const HANDLED_EVENTS: ReadonlyArray<readonly [event: string, kind: AlertKind]> = [
  ['Extreme Heat Warning', 'extreme_heat_warning'],
  ['Heat Advisory', 'heat_advisory'],
  ['Air Quality Alert', 'air_quality_alert'],
];

// Pure. Maps an NWS event name to our AlertKind, null for events we ignore.
export function toAlertKind(event: string): AlertKind | null {
  const name = event.trim().toLowerCase();
  const match = HANDLED_EVENTS.find(([handled]) => handled.toLowerCase() === name);
  return match ? match[1] : null;
}

// Active alerts for San Diego County, already filtered to the event types we handle.
export async function fetchActiveAlerts(): Promise<NwsAlert[]> {
  // TODO: 1. GET https://api.weather.gov/alerts/active with query params status=actual,
  //          zone=<SD_COUNTY_ZONES codes, comma-separated> and event=<HANDLED_EVENTS names, comma-separated,
  //          URL-encoded>. Both comma lists were checked against the live API.
  // TODO: 2. Send headers { 'User-Agent': env.nwsUserAgent(), Accept: 'application/geo+json' }. No API key.
  // TODO: 3. Throw on a non-200 response so the workflow step fails instead of reading an error body as "no alerts".
  // TODO: 4. Map each features[].properties (p) to an NwsAlert:
  //          id = p.id (the "urn:oid:..." value; the feature-level id is a URL), event = p.event,
  //          headline = p.headline, onset = p.onset, expires = p.ends ?? p.expires, zones = p.geocode.UGC.
  //          p.expires is when this message goes stale; p.ends is when the hazard ends, and it is null on
  //          Air Quality Alerts.
  // TODO: 5. Keep only alerts where toAlertKind(event) is not null, in case the event filter changes.
  // TODO: 6. Decide how to treat p.messageType === 'Update'. NWS gives every update a new id and lists the ids it
  //          replaces in p.references[].identifier, so deduping on nws_id alone texts subscribers once per update.
  //          NwsAlert has no field for the replaced ids yet.
  // TODO: 7. Decide whether to add the county code CAC073 to the zone list. Some offices issue Air Quality Alerts
  //          against county codes instead of forecast zones, and no San Diego sample was available to check.
  return notImplemented('nws.fetchActiveAlerts');
}
