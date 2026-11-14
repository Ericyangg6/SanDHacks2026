import { notImplemented } from '../todo';

// NWS public forecast zones covering San Diego County (forecast office SGX). NWS names them
// "San Diego County <name>". Checked against GET https://api.weather.gov/zones?area=CA&type=forecast on 2026-11-14.
export const SD_COUNTY_ZONES = [
  { code: 'CAZ043', name: 'Coastal Areas' },
  { code: 'CAZ050', name: 'Inland Valleys' },
  { code: 'CAZ058', name: 'Mountains' },
  { code: 'CAZ062', name: 'Deserts' },
] as const;

// Zips covered by the given zones. 5-digit strings.
export function zipsForZones(zones: string[]): string[] {
  // TODO: 1. Add a zone -> zips table. Nothing in the repo maps NWS zones to zips yet. One way to build it: take a
  //          lat/lon per San Diego County zip (zip centroids, or M2's sites rows) and read properties.forecastZone
  //          from GET https://api.weather.gov/points/{lat},{lon}. The demo zips in contracts.md (92020, 92037,
  //          92105) are the minimum.
  // TODO: 2. Ignore codes that are not in SD_COUNTY_ZONES. Alerts often span neighbours, e.g. CAZ552 (Orange
  //          County Coastal) arrives alongside CAZ043.
  // TODO: 3. Return the de-duplicated union as 5-digit strings, never numbers.
  // TODO: 4. If nws.ts starts querying the county code CAC073, treat it as every zip in the table.
  return notImplemented('zones.zipsForZones');
}
