import { notImplemented } from '../todo';
import type { CallerNeeds, Language, SubscriberRow } from '../types';

// Outbound is opt-in only: consent_at records the opt-in, opted_out_at records STOP.

export type Keyword = 'stop' | 'start' | 'help' | 'join';

// Compared after uppercasing and stripping accents. The English stop/start/help words are Twilio's defaults.
// The Spanish words are a first guess: have a Spanish speaker check them.
// YES is left out on purpose. Twilio counts it as an opt-in keyword, but it is also an ordinary answer to the text agent.
const KEYWORDS: Record<Keyword, readonly string[]> = {
  stop: [
    'STOP', 'STOPALL', 'UNSUBSCRIBE', 'CANCEL', 'END', 'QUIT', 'REVOKE', 'OPTOUT',
    'ALTO', 'PARAR', 'DETENER', 'CANCELAR', 'BAJA',
  ],
  start: ['START', 'UNSTOP', 'INICIAR', 'COMENZAR'],
  help: ['HELP', 'INFO', 'AYUDA', 'INFORMACION'],
  join: ['JOIN', 'SUBSCRIBE', 'UNIRME', 'SUSCRIBIR', 'SUSCRIBIRME'],
};

// Pure. Matches the carrier keywords (STOP, UNSUBSCRIBE, CANCEL, END, QUIT, START, HELP ...) plus JOIN, in English and Spanish.
// stop / start / help only match when the keyword is the whole message, as the carriers do, so
// "does the bus stop there?" still reaches the text agent. join matches on the first word because a zip follows it.
export function detectKeyword(body: string): Keyword | null {
  const words = body
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toUpperCase()
    .split(/[^A-Z0-9]+/)
    .filter(Boolean);
  if (words.length === 0) return null;
  if (KEYWORDS.join.includes(words[0])) return 'join';
  if (words.length > 1) return null;
  for (const keyword of ['stop', 'start', 'help'] as const) {
    if (KEYWORDS[keyword].includes(words[0])) return keyword;
  }
  return null;
}

// Records an explicit opt-in: upserts the subscriber by phone hash and stamps consent_at. Re-subscribing clears opted_out_at.
export async function subscribe(args: {
  phoneE164: string;
  zip: string;
  language?: Language;
  needs?: CallerNeeds;
}): Promise<SubscriberRow> {
  // TODO: 1. Reject a zip that is not exactly five digits. Zip stays text, never a number.
  // TODO: 2. phoneHash = hashPhone(args.phoneE164). The raw number is never stored or logged (maskPhone for log lines).
  // TODO: 3. getSubscriber(phoneHash) so a re-subscribe keeps the stored language and needs when args omit them. Default language 'en'.
  // TODO: 4. upsertSubscriber({ phoneHash, zip, language, needs, consentAt: new Date() }) and return the row.
  // TODO: 5. Schema gap: upsertSubscriber has nowhere to put a sendable number, so alerts cannot reach this subscriber yet
  //          (see SubscriberContact in ../types).
  return notImplemented('consent.subscribe');
}

// Handles STOP: stamps opted_out_at so send_sms and the alert fan-out skip this number.
export async function optOut(phoneE164: string): Promise<void> {
  // TODO: 1. phoneHash = hashPhone(phoneE164).
  // TODO: 2. setOptedOut(phoneHash, new Date()).
  // TODO: 3. Decide what STOP means for a number with no subscriber row, e.g. a voice caller who got a one-off text.
  //          zip and consent_at are NOT NULL, so there is no row to mark and nothing here stops the next send to them.
  return notImplemented('consent.optOut');
}

// True when the number has a subscriber row with opted_out_at set. send_sms checks this before every send.
export async function isOptedOut(phoneE164: string): Promise<boolean> {
  // TODO: 1. row = await getSubscriber(hashPhone(phoneE164)).
  // TODO: 2. Return row?.opted_out_at != null. No row means not opted out: a caller asking for a text mid-call
  //          is consent for that one message.
  return notImplemented('consent.isOptedOut');
}
