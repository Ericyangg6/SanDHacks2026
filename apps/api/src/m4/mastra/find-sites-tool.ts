import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { findSites } from '../find-sites';
import { LANGUAGES } from '../types';
import type { FindSitesInput, FindSitesOutput } from '../types';

// Mirrors FindSitesInput and FindSitesOutput from the shared contract. The `satisfies` checks catch drift.
const callerNeedsSchema = z.object({
  has_car: z.boolean().optional().describe('False when the person says they have no car.'),
  mobility_issues: z.boolean().optional().describe('True when walking, stairs or distance are hard for them.'),
  needs_clean_air: z.boolean().optional().describe('True when the problem is smoke or air quality rather than heat.'),
  max_travel_minutes: z.number().optional().describe('Longest trip the person will accept, in minutes.'),
});

// TODO: decide whether the model should be able to set lat, lon and now at all. They are in the contract, so
//       they are here, but a wrong `now` changes which sites count as open.
const findSitesInputSchema = z.object({
  location: z.string().describe('Zip code, neighborhood, address or cross streets, as the person gave it.'),
  lat: z.number().optional().describe('Latitude, only if already geocoded. Leave unset otherwise.'),
  lon: z.number().optional().describe('Longitude, only if already geocoded. Leave unset otherwise.'),
  needs: callerNeedsSchema.optional(),
  language: z.enum(LANGUAGES).optional().describe('Language of the reply, used for spoken_summary.'),
  now: z.string().optional().describe('ISO timestamp override for demos and tests. Leave unset.'),
}) satisfies z.ZodType<FindSitesInput>;

const siteResultSchema = z.object({
  site_id: z.number(),
  name: z.string(),
  kind: z.enum(['cool_zone', 'library', 'rec_center', 'community_center', 'senior_center', 'mall', 'other']),
  tier: z.enum(['official', 'discovered']),
  address: z.string(),
  open_now: z.boolean(),
  closes_at: z.string().nullable().describe('"HH:MM" local time today.'),
  hours_today: z.string(),
  travel_minutes: z.number(),
  distance_miles: z.number(),
  aqi: z.number().nullable(),
  has_filtration: z.boolean().nullable().describe('Null means unknown.'),
  confidence: z.number().nullable(),
  call_ahead: z.boolean().describe('True for discovered sites: tell the person to call ahead.'),
  map_url: z.string(),
  spoken_summary: z.string().describe('Ready-to-use sentence that already follows the tier honesty rules.'),
  evidence: z.string().nullable().optional().describe('Exact quote from the source page the hours came from.'),
  source_url: z.string().nullable().optional(),
  source_label: z.string().nullable().optional().describe('Where the hours came from, e.g. "the county\'s Cool Zone list".'),
  hours_verified_at: z.string().nullable().optional().describe('ISO time the hours were last checked against the source.'),
  live_checked: z.boolean().optional().describe('True when the source page was fetched live during this lookup.'),
});

const findSitesOutputSchema = z.object({
  sites: z.array(siteResultSchema).describe('At most 2, best first. May be empty.'),
  resolved_zip: z.string().nullable(),
  fallback_message: z.string().optional().describe('Set when sites is empty, for example "call 211".'),
}) satisfies z.ZodType<FindSitesOutput>;

// Mastra wrapper around M2's find_sites. It adds no ranking or filtering, and it writes nothing: the caller
// logs the calls row.
export const findSitesTool = createTool({
  id: 'find_sites',
  description:
    'Find up to two cooling centers or clean-air spaces that are open right now near a location in San Diego County, best first.',
  inputSchema: findSitesInputSchema,
  outputSchema: findSitesOutputSchema,
  execute: async (input) => findSites(input),
});
