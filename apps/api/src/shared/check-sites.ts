// Prints find_sites results for the demo locations at a few fixed times.
//   cd apps/api && npm run sites:check
//   npm run sites:check -- "Santee, no car"        # one ad-hoc location, right now
import { findSites } from './find-sites';

// Local Pacific times (the -08:00 offset is PST, in effect in November).
const TIMES: Record<string, string> = {
  'Tue 10:00': '2026-11-17T10:00:00-08:00',
  'Tue 21:30': '2026-11-17T21:30:00-08:00',
  'Sun 12:00': '2026-11-22T12:00:00-08:00',
  'Thanksgiving 12:00': '2026-11-26T12:00:00-08:00',
};
const CASES: { location: string; needs?: Record<string, boolean> }[] = [
  { location: '92020' },
  { location: 'El Cajon', needs: { has_car: false } },
  { location: 'La Jolla' },
  { location: 'City Heights', needs: { has_car: false } },
  { location: 'Downtown' },
  { location: '1250 6th Ave, San Diego' },
  { location: '201 E Douglas Ave, El Cajon, CA 92020' },
  { location: 'Main St & Magnolia Ave, El Cajon' },
  { location: 'Parkway Plaza, El Cajon' },
  { location: 'SDSU' },
  { location: 'somewhere on the moon' },
];

// The seed is from Nov 14; allow it for these fixed future dates.
process.env.SITE_MAX_AGE_HOURS ||= '720';

const adhoc = process.argv[2];
const runs = adhoc
  ? [{ label: 'now', now: undefined as string | undefined, cases: [{ location: adhoc, needs: /no car/i.test(adhoc) ? { has_car: false } : undefined }] }]
  : Object.entries(TIMES).map(([label, now]) => ({ label, now, cases: CASES }));

for (const run of runs) {
  console.log(`\n================ ${run.label} ================`);
  for (const c of run.cases) {
    const t0 = Date.now();
    const out = await findSites({ location: c.location, needs: c.needs, now: run.now });
    const ms = Date.now() - t0;
    console.log(`\n> "${c.location}"${c.needs ? ' ' + JSON.stringify(c.needs) : ''}  -> ${out.location_precision ?? '?'}: ${out.resolved_location ?? '-'} (zip ${out.resolved_zip ?? '?'}, ${ms}ms)`);
    if (!out.sites.length) console.log(`  (no sites) ${out.fallback_message}`);
    for (const s of out.sites) {
      console.log(`  #${s.site_id} ${s.name} [${s.tier}] ${s.distance_miles}mi ~${s.travel_minutes}min, ${s.hours_today}`);
      console.log(`     "${s.spoken_summary}"`);
    }
  }
}
