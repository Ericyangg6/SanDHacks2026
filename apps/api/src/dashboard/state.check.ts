// npx tsx src/dashboard/state.check.ts
import assert from 'node:assert/strict';
import { buildState, seedRaw } from './state';

const now = new Date('2026-11-16T11:00:00-08:00'); // Monday morning
const raw = seedRaw();
const site = raw.sites[0];
raw.calls = [
  { id: 1, direction: 'inbound', channel: 'voice', zip: site.zip, site_id: site.id, outcome: 'site_given', started_at: now },
  { id: 2, direction: 'inbound', channel: 'sms', zip: null, site_id: site.id, outcome: 'sms_sent', started_at: now },
];
const s = buildState(raw, now, 'seed');

assert.equal(s.sites.length, raw.sites.length);
assert.ok(s.sites.some((x) => x.open_now) && s.sites.some((x) => !x.open_now));
assert.equal(s.sites[0].referrals_24h, 2);             // both calls count toward the site
assert.equal(s.calls.length, 1);                       // the zip-less call has no map position
assert.ok(Math.abs(s.calls[0].lat - 32.66) < 0.05);
assert.equal(new Set(s.readings.map((r) => r.zip)).size, s.readings.length); // one reading per zip
assert.ok(s.readings.every((r) => r.area && !/\d/.test(r.area) || r.area === r.zip)); // a city name, or the bare zip
assert.equal(s.readings.find((r) => r.zip === '92020')?.area, 'El Cajon');
console.log('state ok:', s.sites.filter((x) => x.open_now).length, 'of', s.sites.length, 'open;', s.readings.length, 'zips');
