// Import the Twilio number into ElevenLabs and point it at the Shade agent.
// Run once (re-running just re-assigns the agent).
//   cd apps/api && npm run el:import-number
import { el, env } from './el.ts';

const agentId = env('ELEVENLABS_AGENT_ID');
let phoneNumberId = env('ELEVENLABS_PHONE_NUMBER_ID', false);

if (!phoneNumberId) {
  const created = await el<{ phone_number_id: string }>('POST', '/v1/convai/phone-numbers', {
    provider: 'twilio',
    phone_number: env('TWILIO_PHONE_NUMBER'),
    label: 'Shade line',
    sid: env('TWILIO_ACCOUNT_SID'),
    token: env('TWILIO_AUTH_TOKEN'),
  });
  phoneNumberId = created.phone_number_id;
  console.log(`imported number. Add this to the root .env:\nELEVENLABS_PHONE_NUMBER_ID=${phoneNumberId}`);
}

await el('PATCH', `/v1/convai/phone-numbers/${phoneNumberId}`, { agent_id: agentId });
console.log(`number ${phoneNumberId} now answers with agent ${agentId}. Call ${env('TWILIO_PHONE_NUMBER')} to test.`);
