// What our tools saw during each call, keyed by ElevenLabs conversation_id.
// post-call.ts uses it to fill in site_id/outcome when the transcript analysis misses them.
// In-memory is fine for one API instance; entries expire after 2 hours.
import type { CallOutcome } from '../../../../data/schema/types';

export interface CallState {
  firstSiteId?: number;
  zip?: string;
  language?: string;
  smsSent?: boolean;
  noSiteFound?: boolean;
  toolError?: boolean;
  touchedAt: number;
}

const TTL_MS = 2 * 60 * 60 * 1000;
const states = new Map<string, CallState>();

export function updateCallState(conversationId: string | undefined, patch: Partial<CallState>): void {
  if (!conversationId) return;
  const now = Date.now();
  for (const [id, s] of states) if (now - s.touchedAt > TTL_MS) states.delete(id);
  states.set(conversationId, { ...states.get(conversationId), ...patch, touchedAt: now });
}

export function takeCallState(conversationId: string): CallState | undefined {
  const s = states.get(conversationId);
  states.delete(conversationId);
  return s;
}

/** Best guess at the outcome from tool activity alone. */
export function outcomeFromState(s: CallState | undefined): CallOutcome | null {
  if (!s) return null;
  if (s.smsSent) return 'sms_sent';
  if (s.firstSiteId) return 'site_given';
  if (s.noSiteFound) return 'no_site_found';
  if (s.toolError) return 'error';
  return null;
}
