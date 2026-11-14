// Webhook tool: text the caller directions to a site.
// The phone number comes from the call itself (system__caller_id), never from the LLM.
// Handled by apps/api/src/elevenlabs/tool-send-sms.ts.

export const sendSmsTool = (apiUrl: string, toolSecret: string) => ({
  tool_config: {
    type: 'webhook',
    name: 'send_sms',
    description:
      "Text the caller the address, today's hours, and a map link for one site. " +
      'Only call this after the caller says yes to getting a text.',
    response_timeout_secs: 10,
    api_schema: {
      url: `${apiUrl}/el/tools/send-sms`,
      method: 'POST',
      request_headers: { 'x-shade-tool-secret': toolSecret },
      request_body_schema: {
        type: 'object',
        properties: {
          site_id: { type: 'integer', description: 'The site_id returned by find_sites.' },
          language: { type: 'string', description: 'Language for the text: en, es, tl, vi, or zh.' },
          caller_id: { type: 'string', dynamic_variable: 'system__caller_id' },
          conversation_id: { type: 'string', dynamic_variable: 'system__conversation_id' },
        },
        required: ['site_id'],
      },
    },
  },
});
