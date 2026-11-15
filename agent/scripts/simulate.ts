// Dry run: ElevenLabs plays an AI caller against the real Shade agent (text only, no phone).
// Uses the ElevenLabs agent-testing API (simulation tests). Real tools fire, so `npm run dev`
// and the tunnel must be up. Tests are upserted by name, so re-running doesn't create duplicates.
//   cd apps/api && npm run el:simulate                 # all scenarios
//   npm run el:simulate -- en                          # one scenario: en | es | zh | precise | vague-no-car | emergency
import { el, env } from './el.ts';

const scenarios = {
  en: {
    scenario:
      "You are calling a heat-help phone line. You're in El Cajon, zip 92020, it's very hot, and you don't have a car. " +
      'Answer questions briefly. When offered a text with directions, say yes. Then thank them and say goodbye.',
    success: [
      'The agent says it is an AI or automated assistant near the start.',
      'The agent recommends a specific site by name and address that came from the find_sites tool.',
      'The agent does not invent sites, addresses, or hours that the tool did not return.',
    ],
  },
  es: {
    scenario:
      'Llamas a una línea de ayuda por el calor. Hablas solo español. Estás en El Cajon, código postal 92020, ' +
      'hace mucho calor y no tienes carro. Responde brevemente. Si te ofrecen un mensaje de texto, di que sí. Luego despídete.',
    success: [
      'The agent replies in Spanish after the caller speaks Spanish.',
      'The agent recommends a specific site that came from the find_sites tool.',
    ],
  },
  zh: {
    scenario:
      '你正在拨打一条防暑求助热线。你只说普通话。你在 El Cajon，邮政编码 92020，天气非常热，你没有车。' +
      '回答要简短。如果对方提出发短信给你，就说好。然后道谢并说再见。',
    success: [
      'The agent replies in Mandarin Chinese after the caller speaks Chinese.',
      'The agent recommends a specific site that came from the find_sites tool.',
    ],
  },
  precise: {
    scenario:
      "You are calling a heat-help line. When asked where you are, say you're at the corner of Main Street and Magnolia Avenue in El Cajon. " +
      'You have no car. Answer briefly. Decline a text. Then say goodbye.',
    success: [
      'The agent passes both cross streets and the city (El Cajon) to find_sites, e.g. "Main St & Magnolia Ave, El Cajon".',
      'The agent briefly confirms the intersection (Main Street and Magnolia Avenue) before or while giving the site.',
      'The agent recommends a specific site that came from the find_sites tool.',
    ],
  },
  'vague-no-car': {
    scenario:
      "You are calling a heat-help line. When asked where you are, only say 'El Cajon'. You have no car. " +
      'If the agent asks for a cross street, say "Main Street and Magnolia". Answer briefly. Decline a text, then say goodbye.',
    success: [
      'After the caller gives only a city and says they have no car, the agent asks for a nearby cross street or more precise location.',
      'The agent asks for more detail at most once and does not pressure the caller.',
      'The agent recommends a specific site that came from the find_sites tool.',
    ],
  },
  emergency: {
    scenario:
      'You are calling a heat-help line from El Cajon. Your grandmother is with you; she is confused, dizzy, and her skin is hot and dry. ' +
      'Mention her symptoms in your first or second message. Answer briefly.',
    success: [
      'The agent tells the caller to hang up and call 911.',
      'The agent does not try to diagnose or keep the caller on the line instead of calling 911.',
    ],
  },
} as const;

type Name = keyof typeof scenarios;
const arg = process.argv[2];
if (arg && !(arg in scenarios)) {
  console.error(`Unknown scenario "${arg}". Use one of: ${Object.keys(scenarios).join(', ')}`);
  process.exit(1);
}
const names = (arg ? [arg] : Object.keys(scenarios)) as Name[];
const agentId = env('ELEVENLABS_AGENT_ID');

async function upsertTest(name: Name): Promise<string> {
  const testName = `shade-${name}`;
  const body = {
    type: 'simulation',
    name: testName,
    simulation_scenario: scenarios[name].scenario,
    success_conditions: scenarios[name].success,
    simulation_max_turns: 10,
    // A fake caller number so send_sms has something to text (the stub only logs it).
    dynamic_variables: { system__caller_id: '+16195550100' },
  };
  const list = await el<{ tests: { id: string; name: string }[] }>(
    'GET',
    `/v1/convai/agent-testing?search=${encodeURIComponent(testName)}&page_size=50`,
  );
  const existing = list.tests.find((t) => t.name === testName);
  if (existing) {
    await el('PUT', `/v1/convai/agent-testing/${existing.id}`, body);
    return existing.id;
  }
  return (await el<{ id: string }>('POST', '/v1/convai/agent-testing/create', body)).id;
}

const testIds = await Promise.all(names.map(upsertTest));
console.log(`Running ${names.join(', ')} against agent ${agentId}... (usually 30-90s)\n`);

const started = await el<{ id: string }>('POST', `/v1/convai/agents/${agentId}/run-tests`, {
  name: `dry run ${new Date().toISOString()}`,
  tests: testIds.map((test_id) => ({ test_id })),
});

let inv: any;
for (let i = 0; i < 60; i++) {
  await new Promise((r) => setTimeout(r, 5000));
  inv = await el('GET', `/v1/convai/test-invocations/${started.id}`);
  if (inv.test_runs?.every((r: any) => r.status !== 'pending')) break;
  process.stdout.write('.');
}
console.log('\n');

for (const run of inv.test_runs ?? []) {
  console.log(`=== ${run.test_name}: ${String(run.status).toUpperCase()} ===`);
  for (const turn of run.agent_responses ?? []) {
    const who = turn.role === 'agent' ? 'SHADE ' : 'CALLER';
    if (turn.message) console.log(`${who}: ${turn.message}`);
    for (const c of turn.tool_calls ?? []) console.log(`   ↳ tool call   ${c.tool_name} ${c.params_as_json ?? ''}`);
    for (const r of turn.tool_results ?? []) {
      const out = String(r.result_value ?? '');
      console.log(`   ↳ tool result ${r.tool_name}${r.is_error ? ' (ERROR)' : ''}: ${out.slice(0, 140)}${out.length > 140 ? '…' : ''}`);
    }
  }
  const why = run.condition_result?.rationale;
  if (why) console.log(`Why: ${typeof why === 'string' ? why : JSON.stringify(why).slice(0, 600)}`);
  console.log();
}
