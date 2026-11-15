// send_sms (owner: M4). The real sender lives in ../m4/sms/send-sms.ts: site lookup, message text, opt-out check.
// Shade cannot send SMS yet, so it holds the site details for the caller's linked Facebook Messenger profile and
// sends them the next time they message the Page; the result's `note` says what to tell the caller. Set
// M4_SMS_DRY_RUN=1 to log the text instead, for callers with no linked profile.
export { sendSms } from '../m4/sms/send-sms';
