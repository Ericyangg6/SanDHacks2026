// NWS active-alert poller for San Diego County. Free API, no key, requires a User-Agent.
// Docs: https://www.weather.gov/documentation/services-web-api

export const SD_ZONES = {
  CAZ043: "Coastal",
  CAZ050: "Inland Valleys",
  CAZ058: "Mountains",
  CAZ062: "Deserts",
} as const;

// Events that should trigger the "nearest open site" text workflow.
export const TRIGGER_EVENTS = new Set([
  "Extreme Heat Warning",
  "Extreme Heat Watch",
  "Heat Advisory",
  "Excessive Heat Warning", // legacy name, kept in case NWS reuses it
  "Air Quality Alert",
  "Red Flag Warning", // smoke risk; drop if too noisy
]);

export type HeatAlert = {
  id: string;
  event: string;
  severity: string;
  headline: string;
  areaDesc: string;
  zones: string[]; // e.g. ["CAZ043"]
  onset: string | null;
  expires: string | null;
  mock?: boolean;
};

const UA = process.env.NWS_USER_AGENT ?? "shade-sandhacks";

export async function fetchSanDiegoAlerts(): Promise<HeatAlert[]> {
  const zones = Object.keys(SD_ZONES).join(",");
  const res = await fetch(`https://api.weather.gov/alerts/active?zone=${zones}`, {
    headers: { "User-Agent": UA, Accept: "application/geo+json" },
  });
  if (!res.ok) throw new Error(`NWS ${res.status}`);
  const data = (await res.json()) as { features: { id: string; properties: any }[] };
  return data.features
    .filter((f) => TRIGGER_EVENTS.has(f.properties.event))
    .map((f) => ({
      id: f.id,
      event: f.properties.event,
      severity: f.properties.severity,
      headline: f.properties.headline,
      areaDesc: f.properties.areaDesc,
      zones: (f.properties.affectedZones as string[]).map((z) => z.split("/").pop()!),
      onset: f.properties.onset ?? f.properties.effective,
      expires: f.properties.expires,
    }));
}

// Demo button: pretend a heat alert just fired.
export function mockHeatAlert(zones: string[] = ["CAZ043"]): HeatAlert {
  return {
    id: `mock-${Date.now()}`,
    event: "Extreme Heat Warning",
    severity: "Severe",
    headline: "MOCK: Extreme Heat Warning for San Diego County",
    areaDesc: "San Diego County (mock)",
    zones,
    onset: new Date().toISOString(),
    expires: new Date(Date.now() + 36e5 * 12).toISOString(),
    mock: true,
  };
}

// Returns only alerts not seen before. Persist `seen` in Neon in production.
export function newAlerts(alerts: HeatAlert[], seen: Set<string>): HeatAlert[] {
  return alerts.filter((a) => !seen.has(a.id));
}
