import { env } from '../env';
import type { AlertKind } from '../types';
import { SD_COUNTY_CODE, SD_COUNTY_ZONES } from './zones';

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

const NWS_TIMEOUT_MS = 15_000;

// Pure. Maps an NWS event name to our AlertKind, null for events we ignore.
export function toAlertKind(event: string): AlertKind | null {
  const name = event.trim().toLowerCase();
  const match = HANDLED_EVENTS.find(([handled]) => handled.toLowerCase() === name);
  return match ? match[1] : null;
}

interface NwsFeature {
  properties: {
    id: string;
    event: string;
    headline?: string | null;
    onset?: string | null;
    ends?: string | null;
    expires?: string | null;
    geocode?: { UGC?: string[] };
  };
}

// Pure. Turns an /alerts/active response into NwsAlerts, keeping only the events we handle.
// Updates (messageType 'Update') are kept like any other alert: NWS gives each one a new id, so each becomes its
// own alerts row, and the cooldown in dispatchAlert keeps subscribers from being texted once per update.
export function toNwsAlerts(body: { features?: NwsFeature[] }): NwsAlert[] {
  return (body.features ?? []).flatMap(({ properties: p }) => {
    if (!p?.id || !p.event || !toAlertKind(p.event)) return [];
    return [
      {
        // The "urn:oid:..." value. The feature-level id is a URL.
        id: p.id,
        event: p.event,
        headline: p.headline ?? null,
        onset: p.onset ?? null,
        // ends is when the hazard ends; expires is when this message goes stale. ends is null on Air Quality Alerts.
        expires: p.ends ?? p.expires ?? null,
        zones: p.geocode?.UGC ?? [],
      },
    ];
  });
}

// Active alerts for San Diego County, already filtered to the event types we handle. Read-only, no API key.
// Throws on any failure, so the workflow step fails instead of reading an error as "no alerts".
export async function fetchActiveAlerts(): Promise<NwsAlert[]> {
  const params = new URLSearchParams({
    status: 'actual',
    zone: [...SD_COUNTY_ZONES.map((z) => z.code), SD_COUNTY_CODE].join(','),
    event: HANDLED_EVENTS.map(([event]) => event).join(','),
  });
  const response = await fetch(`https://api.weather.gov/alerts/active?${params}`, {
    headers: { 'User-Agent': env.nwsUserAgent(), Accept: 'application/geo+json' },
    signal: AbortSignal.timeout(NWS_TIMEOUT_MS),
  });
  if (!response.ok) throw new Error(`NWS alerts request failed: HTTP ${response.status}`);
  return toNwsAlerts((await response.json()) as { features?: NwsFeature[] });
}
