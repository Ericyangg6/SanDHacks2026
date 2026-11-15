import { ZONE_ZIPS } from './zone-zips';

// NWS public forecast zones covering San Diego County (forecast office SGX). NWS names them
// "San Diego County <name>". Checked against GET https://api.weather.gov/zones?area=CA&type=forecast on 2026-11-14.
export const SD_COUNTY_ZONES = [
  { code: 'CAZ043', name: 'Coastal Areas' },
  { code: 'CAZ050', name: 'Inland Valleys' },
  { code: 'CAZ058', name: 'Mountains' },
  { code: 'CAZ062', name: 'Deserts' },
] as const;

// San Diego County's county code. Some offices issue Air Quality Alerts against county codes instead of forecast
// zones (2 of the 4 recent ones nationwide on 2026-11-14), so it is queried too and means every zip in the county.
export const SD_COUNTY_CODE = 'CAC073';

// Zips covered by the given zones, as 5-digit strings. Codes outside San Diego County are ignored: alerts often
// span neighbours, e.g. CAZ552 (Orange County Coastal) arrives alongside CAZ043.
export function zipsForZones(zones: string[]): string[] {
  const codes = zones.includes(SD_COUNTY_CODE) ? Object.keys(ZONE_ZIPS) : zones;
  return [...new Set(codes.flatMap((code) => ZONE_ZIPS[code] ?? []))].sort();
}
