// STUB until M4 ships the real Twilio sender. Keep the signature; M4 replaces the body.
import type { SendSmsInput, SendSmsOutput } from '../../../../data/schema/types';
import { maskPhone } from './phone';

export async function sendSms(input: SendSmsInput): Promise<SendSmsOutput> {
  console.log(`[send_sms stub] would text site ${input.site_id} (${input.language ?? 'en'}) to ${maskPhone(input.to)}`);
  return { ok: true };
}
