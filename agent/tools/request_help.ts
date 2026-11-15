// Webhook tool: file a help request for a dispatcher (a person) to answer.
// The phone number comes from the call itself (system__caller_id), never from the LLM.
// Handled by apps/api/src/requests/requests.ts.

export const requestHelpTool = (apiUrl: string, toolSecret: string) => ({
  tool_config: {
    type: 'webhook',
    name: 'request_help',
    description:
      'Send a help request to a human dispatcher when the caller asks for a ride, a pickup, or someone to check on them, ' +
      'or cannot get to a site on their own. It only sends the request. It does not confirm that help is coming. ' +
      'Read the say_this line from the result to the caller.',
    response_timeout_secs: 10,
    api_schema: {
      url: `${apiUrl}/el/tools/request-help`,
      method: 'POST',
      request_headers: { 'x-shade-tool-secret': toolSecret },
      request_body_schema: {
        type: 'object',
        properties: {
          said: {
            type: 'string',
            description: "The caller's own words about what they need, as close to exact as you can. Do not summarize, translate or add anything.",
          },
          location: {
            type: 'string',
            description: 'Where the caller is, in their own words, the same way you pass it to find_sites.',
          },
          needs: {
            type: 'array',
            items: { type: 'string', description: 'One short fact, in English.' },
            description: 'Short facts the caller stated, for example "no car", "uses a wheelchair", "2 people", "dehydrated". Only what they said.',
          },
          language: { type: 'string', description: 'Language the caller is speaking: en, es, tl, vi, or zh.' },
          caller_id: { type: 'string', dynamic_variable: 'system__caller_id' },
          conversation_id: { type: 'string', dynamic_variable: 'system__conversation_id' },
        },
        required: ['said', 'location'],
      },
    },
  },
});
