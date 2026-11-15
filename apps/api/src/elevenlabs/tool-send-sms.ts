// ElevenLabs server tool -> shared send_sms (owned by M4).
// The number comes from the call (system__caller_id). A caller asking for a text counts as
// consent for that one message (contracts.md). Raw numbers are never logged.
import { z } from 'zod';
import type { SendSmsOutput } from '../../../../data/schema/types';
import { sendSms } from '../shared/send-sms';
import { updateCallState } from './call-state';

export const sendSmsBody = z.object({
  site_id: z.coerce.number().int(),
  language: z.enum(['en', 'es', 'tl', 'vi', 'zh']).optional().catch(undefined),
  caller_id: z.string().optional(),
  conversation_id: z.string().optional(),
});

const OPTED_OUT =
  "This number has opted out of texts from us, so I can't send one. Texting START to this number turns them back on.";
const NOT_SENT = "The text didn't go through. Please write the address down.";

// M4 returns machine codes (opted_out, invalid_number, site_not_found, twilio_<code>, ...). The agent says `error`
// to the caller, so turn the code into words and keep the code itself for the logs.
export async function handleSendSms(body: z.infer<typeof sendSmsBody>): Promise<SendSmsOutput & { code?: string }> {
  const to = body.caller_id?.trim();
  if (!to || !/^\+\d{10,15}$/.test(to)) {
    // Hidden caller ID or a web test call: nothing to text.
    return { ok: false, error: "I can't see your phone number, so I can't send a text. Please write the address down." };
  }
  try {
    const result = await sendSms({ to, site_id: body.site_id, language: body.language });
    if (result.ok) {
      updateCallState(body.conversation_id, { smsSent: true });
      return result;
    }
    const code = result.error ?? 'unknown';
    console.warn(`[el send_sms] not sent: ${code} (site ${body.site_id})`);
    return { ok: false, error: code === 'opted_out' ? OPTED_OUT : NOT_SENT, code };
  } catch (err) {
    console.error('[el send_sms] failed', err);
    updateCallState(body.conversation_id, { toolError: true });
    return { ok: false, error: 'The text could not be sent. Please write the address down.' };
  }
}
