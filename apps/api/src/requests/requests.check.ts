// npx tsx --env-file=../../.env src/requests/requests.check.ts
// The database part writes and deletes one test row, so it runs only with REQUESTS_CHECK_DB=1.
import assert from 'node:assert/strict';
import { db } from '../shared/db';
import { handleRequestHelp, INBOX_COLUMNS, listOpenRequests, requestHelpBody, sayThis } from './requests';

// The caller's words and a location are required; a bad needs list is dropped, not fatal.
assert.equal(requestHelpBody.safeParse({ said: ' ', location: 'El Cajon' }).success, false);
assert.equal(requestHelpBody.safeParse({ said: 'I need a ride' }).success, false);
assert.equal(requestHelpBody.parse({ said: 'I need a ride', location: 'El Cajon', needs: 'no car' }).needs, undefined);

// An unanswered request never sounds like a promise.
assert.match(sayThis('requesting'), /No one has confirmed/);
assert.doesNotMatch(sayThis('requesting'), /on the way|will be there|minutes/i);

// The inbox never selects the callback number.
assert.ok(!INBOX_COLUMNS.includes('phone'));

if (db && process.env.REQUESTS_CHECK_DB === '1') {
  const conversation_id = `check-${Date.now()}`;
  const body = { said: 'No car, really thirsty.', location: 'El Cajon 92020', needs: ['no car'], caller_id: '+16195550100', conversation_id };
  try {
    const first = await handleRequestHelp(body);
    const again = await handleRequestHelp(body);
    assert.equal(first.ok, true);
    assert.equal(first.status, 'requesting');
    assert.equal(again.request_id, first.request_id); // one request per call
    const mine = (await listOpenRequests()).find((r) => r.id === first.request_id);
    assert.ok(mine && mine.lat != null);
    assert.ok(!('phone_e164' in mine));
    console.log('requests db ok: request', first.request_id);
  } finally {
    await db.query(`delete from requests where conversation_id = $1`, [conversation_id]);
    await db.end();
  }
} else {
  await db?.end();
  console.log('requests ok (database part skipped: set REQUESTS_CHECK_DB=1)');
}
