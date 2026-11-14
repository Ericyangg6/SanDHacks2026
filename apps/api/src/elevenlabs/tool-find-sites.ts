// ElevenLabs server tool -> shared find_sites (owned by M2).
import { z } from 'zod';
import type { FindSitesOutput } from '../../../../data/schema/types';
import { findSites } from '../shared/find-sites';
import { updateCallState } from './call-state';

const FALLBACK = "I couldn't find an open site near you right now. You can call 2 1 1 any time. They can help, and they can arrange a free ride.";

export const findSitesBody = z.object({
  location: z.string().min(1),
  has_car: z.boolean().optional(),
  mobility_issues: z.boolean().optional(),
  needs_clean_air: z.boolean().optional(),
  language: z.enum(['en', 'es', 'tl', 'vi', 'zh']).optional().catch(undefined),
  conversation_id: z.string().optional(),
});

export async function handleFindSites(body: z.infer<typeof findSitesBody>): Promise<FindSitesOutput> {
  const { conversation_id, location, language, ...needs } = body;
  try {
    const result = await findSites({ location, language, needs });
    updateCallState(conversation_id, {
      firstSiteId: result.sites[0]?.site_id,
      zip: result.resolved_zip ?? undefined,
      language,
      noSiteFound: result.sites.length === 0,
    });
    if (result.sites.length === 0 && !result.fallback_message) {
      return { ...result, fallback_message: FALLBACK };
    }
    return result;
  } catch (err) {
    console.error('[el find_sites] failed', err);
    updateCallState(conversation_id, { toolError: true });
    // Return a usable answer instead of an HTTP error so the agent can still help the caller.
    return { sites: [], resolved_zip: null, fallback_message: FALLBACK };
  }
}
