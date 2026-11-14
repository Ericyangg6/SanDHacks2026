// Stretch (with M4): have the Shade agent place an outbound check-in call.
// Dynamic variables are available in the prompt as {{name}}.
export async function startOutboundCall(to: string, dynamicVariables: Record<string, string | number> = {}) {
  const res = await fetch('https://api.elevenlabs.io/v1/convai/twilio/outbound-call', {
    method: 'POST',
    headers: { 'xi-api-key': process.env.ELEVENLABS_API_KEY ?? '', 'content-type': 'application/json' },
    body: JSON.stringify({
      agent_id: process.env.ELEVENLABS_AGENT_ID,
      agent_phone_number_id: process.env.ELEVENLABS_PHONE_NUMBER_ID,
      to_number: to,
      conversation_initiation_client_data: { dynamic_variables: dynamicVariables },
    }),
  });
  if (!res.ok) throw new Error(`outbound call failed: ${res.status} ${await res.text()}`);
  return (await res.json()) as { success: boolean; conversation_id?: string; callSid?: string };
}
