// Spike (PLAN.md T1): can we read a call's transcript while the call is still in progress?
// Polls the conversation every 2s and prints its status and how many transcript turns the API returns.
// Start a call first, then:
//   cd apps/api && npm run el:transcript                     # the agent's most recent conversation
//   npm run el:transcript -- <conversation_id>
import { el, env } from './el.ts';

const id =
  process.argv[2] ??
  (await el<{ conversations: { conversation_id: string }[] }>(
    'GET',
    `/v1/convai/conversations?agent_id=${env('ELEVENLABS_AGENT_ID')}&page_size=1`,
  )).conversations[0]?.conversation_id;
if (!id) throw new Error('No conversation found. Start a call first.');

const t0 = Date.now();
for (;;) {
  const c = await el<{ status: string; transcript?: { role: string; message?: string }[] }>('GET', `/v1/convai/conversations/${id}`);
  const last = c.transcript?.at(-1);
  console.log(`+${Math.round((Date.now() - t0) / 1000)}s ${c.status} turns=${c.transcript?.length ?? 0}${last ? ` last=${last.role}: ${last.message ?? ''}` : ''}`);
  if (c.status === 'done' || c.status === 'failed') break;
  await new Promise((r) => setTimeout(r, 2000));
}
