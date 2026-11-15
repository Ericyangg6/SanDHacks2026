// ElevenLabs post-call webhook -> one `calls` row per conversation.
// Combines the agent's data-collection fields (agent/agent.config.ts) with what our tools saw.
import type { CallOutcome } from '../../../../data/schema/types';
import { insertCall } from '../shared/calls';
import { hashPhone } from '../shared/phone';
import { outcomeFromState, takeCallState } from './call-state';
import { followUpAfterCall } from '../m4/sms/send-sms';

const OUTCOMES: CallOutcome[] = ['site_given', 'sms_sent', 'no_site_found', 'escalated_911', 'abandoned', 'error'];

interface PostCallEvent {
  type: string;
  data: {
    conversation_id: string;
    metadata?: {
      start_time_unix_secs?: number;
      call_duration_secs?: number;
      main_language?: string;
      phone_call?: { direction?: 'inbound' | 'outbound'; external_number?: string };
    };
    analysis?: { data_collection_results?: Record<string, { value?: unknown }> };
  };
}

const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null);

export async function handlePostCall(event: PostCallEvent): Promise<void> {
  if (event.type !== 'post_call_transcription') return; // ignore audio / initiation-failure events

  const { conversation_id, metadata = {}, analysis = {} } = event.data;
  const dc = analysis.data_collection_results ?? {};
  const state = takeCallState(conversation_id);

  const analyzedOutcome = str(dc.outcome?.value) as CallOutcome | null;
  // Trust the transcript for 911 (no tool marks it); otherwise prefer what the tools actually did.
  const outcome =
    analyzedOutcome === 'escalated_911'
      ? analyzedOutcome
      : outcomeFromState(state) ?? (analyzedOutcome && OUTCOMES.includes(analyzedOutcome) ? analyzedOutcome : 'abandoned');

  const zipRaw = str(dc.zip?.value) ?? state?.zip ?? null;
  const siteRaw = Number(dc.site_id?.value);
  const start = metadata.start_time_unix_secs ? new Date(metadata.start_time_unix_secs * 1000) : new Date();
  const phone = metadata.phone_call?.external_number;
  const direction = metadata.phone_call?.direction ?? 'inbound';
  const language = str(dc.language?.value) ?? state?.language ?? metadata.main_language ?? null;
  const siteId = state?.firstSiteId ?? (Number.isInteger(siteRaw) && siteRaw > 0 ? siteRaw : null);

  try {
    await insertCall({
      direction,
      channel: 'voice',
      phone_hash: phone ? hashPhone(phone) : null,
      zip: zipRaw && /^\d{5}$/.test(zipRaw) ? zipRaw : null,
      language,
      site_id: siteId,
      outcome,
      started_at: start,
      ended_at: metadata.call_duration_secs != null ? new Date(start.getTime() + metadata.call_duration_secs * 1000) : null,
    });
  } finally {
    // M4: hold the site for the caller's linked Facebook Messenger, if they have one (JOIN <zip> <phone>); it goes
    // out the next time they message the Page. No-op for everyone else. Never throws.
    if (phone && direction === 'inbound') await followUpAfterCall({ phoneE164: phone, siteId, language });
  }
}
