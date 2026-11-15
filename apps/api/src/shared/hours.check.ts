// npx tsx src/shared/hours.check.ts
import assert from 'node:assert/strict';
import { hoursToday } from './hours';

const at = (iso: string) => new Date(`${iso}-08:00`); // November in San Diego is PST
const lib = { weekly: [{ day: 1, open: '09:00', close: '20:00' }], exceptions: [{ date: '2026-11-23', closed: true }] };
const late = { weekly: [{ day: 1, open: '07:00', close: '02:00' }] };

assert.deepEqual(hoursToday(lib, at('2026-11-16T10:00')), { open_now: true, closes_at: '20:00', hours_today: '9:00 AM - 8:00 PM' });
assert.equal(hoursToday(lib, at('2026-11-16T20:00')).open_now, false);     // close is exclusive
assert.equal(hoursToday(lib, at('2026-11-16T08:59')).open_now, false);
assert.equal(hoursToday(lib, at('2026-11-17T10:00')).hours_today, 'Closed today'); // Tuesday: no interval
assert.equal(hoursToday(lib, at('2026-11-23T10:00')).open_now, false);     // holiday exception
assert.equal(hoursToday(late, at('2026-11-16T23:30')).open_now, true);     // overnight, before midnight
assert.deepEqual(hoursToday(late, at('2026-11-17T01:30')), { open_now: true, closes_at: '02:00', hours_today: 'Closed today' });
assert.equal(hoursToday(late, at('2026-11-17T02:00')).open_now, false);
assert.equal(hoursToday(lib, new Date('2026-11-16T18:00:00Z')).open_now, true); // 10:00 local from a UTC instant
console.log('hours ok');
