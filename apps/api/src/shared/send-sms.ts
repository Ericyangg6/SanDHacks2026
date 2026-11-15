// send_sms, owned by M4 (apps/api/src/m4/sms/send-sms.ts). Signature unchanged.
// Shade cannot send SMS yet, so M4 holds the site details for the caller's linked Facebook Messenger profile and
// sends them the next time they message the Page; the result's `note` says what to tell the caller.
import type { SendSmsInput, SendSmsOutput } from '../../../../data/schema/types';
import { sendSms as m4SendSms } from '../m4/sms/send-sms';

export async function sendSms(input: SendSmsInput): Promise<SendSmsOutput> {
  return m4SendSms(input);
}
