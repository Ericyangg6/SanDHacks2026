// Webhook tool: the agent calls our Mastra API to find the nearest open sites.
// Handled by apps/api/src/elevenlabs/tool-find-sites.ts.

export const findSitesTool = (apiUrl: string, toolSecret: string) => ({
  tool_config: {
    type: 'webhook',
    name: 'find_sites',
    description:
      'Find the two best open cooling centers or clean-air sites near the caller. ' +
      'Call this once you know roughly where the caller is.',
    response_timeout_secs: 10,
    api_schema: {
      url: `${apiUrl}/el/tools/find-sites`,
      method: 'POST',
      request_headers: { 'x-shade-tool-secret': toolSecret },
      request_body_schema: {
        type: 'object',
        properties: {
          location: {
            type: 'string',
            description: 'Where the caller is, in their own words: a building or campus spot (Geisel Library at UCSD), a store, mall, hospital, park, trolley station, address, cross streets, neighborhood, city, or zip code. Pass the whole phrase.',
          },
          has_car: { type: 'boolean', description: 'True if the caller has a car. Omit if unknown.' },
          mobility_issues: { type: 'boolean', description: 'True if the caller has trouble walking. Omit if unknown.' },
          needs_clean_air: { type: 'boolean', description: 'True if the concern is wildfire smoke rather than heat.' },
          language: {
            type: 'string',
            description: 'Language the caller is speaking: en, es, tl, vi, or zh.',
          },
          conversation_id: { type: 'string', dynamic_variable: 'system__conversation_id' },
        },
        required: ['location'],
      },
    },
  },
});
