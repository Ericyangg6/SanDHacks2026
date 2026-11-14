// Stretch: have the agent call a number (e.g. an alert check-in).
//   cd apps/api && npm run el:call -- +16195551234
import { el, env } from './el.ts';

const to = process.argv[2];
if (!/^\+\d{10,15}$/.test(to ?? '')) {
  console.error('Usage: npm run el:call -- +1XXXXXXXXXX');
  process.exit(1);
}

const res = await el('POST', '/v1/convai/twilio/outbound-call', {
  agent_id: env('ELEVENLABS_AGENT_ID'),
  agent_phone_number_id: env('ELEVENLABS_PHONE_NUMBER_ID'),
  to_number: to,
});
console.log(res);
