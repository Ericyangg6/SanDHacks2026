// STUB until M2 ships the real find_sites (database read + ranking).
// Keep the signature; M2 replaces the body. Returns seed-shaped data so the voice line works end to end.
import type { FindSitesInput, FindSitesOutput, SiteResult } from '../../../../data/schema/types';

const STUB_SITES: SiteResult[] = [
  {
    site_id: 1,
    name: 'El Cajon Library',
    kind: 'library',
    tier: 'official',
    address: '201 East Douglas Avenue, El Cajon, CA 92020',
    open_now: true,
    closes_at: '20:00',
    hours_today: '9:00 AM - 8:00 PM',
    travel_minutes: 12,
    distance_miles: 1.1,
    aqi: 42,
    has_filtration: null,
    confidence: null,
    call_ahead: false,
    map_url: 'https://maps.google.com/?q=201+E+Douglas+Ave+El+Cajon+CA+92020',
    spoken_summary:
      'The closest option is the El Cajon Library at 2 0 1 East Douglas Avenue. It is an official cooling center, open until 8 tonight.',
  },
  {
    site_id: 2,
    name: 'Parkway Plaza',
    kind: 'mall',
    tier: 'discovered',
    address: '415 Parkway Plaza, El Cajon, CA 92020',
    open_now: true,
    closes_at: '21:00',
    hours_today: '10:00 AM - 9:00 PM',
    travel_minutes: 18,
    distance_miles: 1.9,
    aqi: 45,
    has_filtration: null,
    confidence: 0.8,
    call_ahead: true,
    map_url: 'https://maps.google.com/?q=415+Parkway+Plaza+El+Cajon+CA+92020',
    spoken_summary:
      "Another option is Parkway Plaza mall at 4 1 5 Parkway Plaza. It's not an official cooling center, but it should be air conditioned and open until 9 tonight. You may want to call ahead.",
  },
];

export async function findSites(_input: FindSitesInput): Promise<FindSitesOutput> {
  return { sites: STUB_SITES, resolved_zip: '92020' };
}
