// Fake help requests for looking at the dispatcher inbox. They go through the handler behind the agent's request_help
// webhook, so location lookup and the insert are the real path. No phone numbers are sent.
//   npx tsx --env-file=../../.env src/requests/mock.ts          file the requests
//   npx tsx --env-file=../../.env src/requests/mock.ts clear    delete them
import { db } from '../shared/db';
import { logEvent } from './events';
import { handleRequestHelp, requestHelpBody } from './requests';

const MOCKS = [
  { said: "My AC broke yesterday and I don't have a car. I'm 81 and I'm feeling dizzy.", location: 'Main Street and Magnolia Avenue, El Cajon', needs: ['no car', 'age 81', 'dizzy', 'lives alone'], language: 'en' },
  { said: 'Estoy con mis dos hijos y no tenemos como llegar a la biblioteca. Hace mucho calor en el apartamento.', location: 'San Ysidro 92173', needs: ['no car', '3 people', '2 children'], language: 'es' },
  { said: "I use a wheelchair and the bus stop is too far in this heat. Can someone pick me up?", location: 'City Heights, near University Ave and Fairmount', needs: ['uses a wheelchair', 'no car'], language: 'en' },
  { said: 'Can someone check on my neighbor? He is not answering the door and his windows are shut.', location: '250 E Grand Ave, Escondido', needs: ['wellness check', 'calling for a neighbor'], language: 'en' },
  { said: 'Bà tôi bị mệt, nhà không có máy lạnh. Chúng tôi cần xe đến chỗ mát.', location: 'Linda Vista 92111', needs: ['no AC', 'elderly', '2 people'], language: 'vi' },
];

if (!db) throw new Error('NEON_DATABASE_URL is not set');
if (process.argv[2] === 'clear') {
  const { rowCount } = await db.query(`delete from requests where conversation_id like 'mock-%'`);
  await db.query(`delete from call_events where conversation_id like 'mock-%'`);
  console.log(`deleted ${rowCount} mock requests and their trails`);
} else {
  const ids: number[] = [];
  for (const [i, m] of MOCKS.entries()) {
    // The steps a real call leaves before it asks for help, backdated so the trail reads like a call.
    const conversation_id = `mock-${Date.now()}-${i}`, ago = (s: number) => new Date(Date.now() - s * 1000);
    const zip = m.location.match(/\d{5}/)?.[0];
    await logEvent(conversation_id, 'call_started', '', ago(95 + i * 40));
    await logEvent(conversation_id, 'located', zip ? `Placed the caller in ${zip} (from a zip code)` : 'Placed the caller (from an address)', ago(60 + i * 40));
    await logEvent(conversation_id, 'site_suggested', 'Suggested the nearest open cool zone', ago(58 + i * 40));
    const out = await handleRequestHelp(requestHelpBody.parse({ ...m, conversation_id }));
    console.log(m.location, '->', out.request_id ?? 'failed', '|', out.say_this);
    if (out.request_id) ids.push(out.request_id);
  }
  // No dispatcher endpoint yet, so show the second state by hand on one of them.
  if (ids[2]) {
    const { rows } = await db.query(`update requests set status = 'incoming', help_type = 'volunteer_pickup', updated_at = now() where id = $1 returning conversation_id`, [ids[2]]);
    await logEvent(rows[0].conversation_id, 'help_incoming', 'Dispatcher confirmed a volunteer pickup. Help is incoming');
  }
  // One call still in progress that has not asked for help: shows as "On call" above the requests.
  const live = `mock-${Date.now()}-live`;
  await logEvent(live, 'call_started', '');
  await logEvent(live, 'located', 'Placed the caller in 92020 (from cross streets)');
}
await db.end();
