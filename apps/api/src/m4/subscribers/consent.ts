import { getSubscriber, setOptedOut, upsertSubscriber } from '../db';
import { hashPhone, toE164 } from '../phone';
import type { CallerNeeds, Language, SubscriberRow } from '../types';

// Outbound is opt-in only: consent_at records the opt-in, opted_out_at records STOP.

export type Keyword = 'stop' | 'start' | 'help' | 'join';

// The keyword a text matched, and the language of the word that matched it.
export interface KeywordMatch {
  keyword: Keyword;
  language: 'en' | 'es';
}

// Compared after uppercasing and stripping accents. The English stop/start/help words are Twilio's defaults.
// The Spanish words are a first guess: have a Spanish speaker check them.
// YES is left out on purpose. Twilio counts it as an opt-in keyword, but it is also an ordinary answer to the text agent.
const KEYWORDS: Record<Keyword, Record<'en' | 'es', readonly string[]>> = {
  stop: {
    en: ['STOP', 'STOPALL', 'UNSUBSCRIBE', 'CANCEL', 'END', 'QUIT', 'REVOKE', 'OPTOUT'],
    es: ['ALTO', 'PARAR', 'DETENER', 'CANCELAR', 'BAJA'],
  },
  start: { en: ['START', 'UNSTOP'], es: ['INICIAR', 'COMENZAR'] },
  help: { en: ['HELP', 'INFO'], es: ['AYUDA', 'INFORMACION'] },
  join: { en: ['JOIN', 'SUBSCRIBE'], es: ['UNIRME', 'SUSCRIBIR', 'SUSCRIBIRME'] },
};

function matchWord(keyword: Keyword, word: string): KeywordMatch | null {
  for (const language of ['en', 'es'] as const) {
    if (KEYWORDS[keyword][language].includes(word)) return { keyword, language };
  }
  return null;
}

// Pure. Matches the carrier keywords (STOP, UNSUBSCRIBE, CANCEL, END, QUIT, START, HELP ...) plus JOIN, in English and Spanish.
// stop / start / help only match when the keyword is the whole message, as the carriers do, so
// "does the bus stop there?" still reaches the text agent. join matches on the first word because a zip follows it.
export function detectKeyword(body: string): KeywordMatch | null {
  const words = body
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toUpperCase()
    .split(/[^A-Z0-9]+/)
    .filter(Boolean);
  if (words.length === 0) return null;
  const join = matchWord('join', words[0]);
  if (join) return join;
  if (words.length > 1) return null;
  for (const keyword of ['stop', 'start', 'help'] as const) {
    const match = matchWord(keyword, words[0]);
    if (match) return match;
  }
  return null;
}

// Records an explicit opt-in: upserts the subscriber by phone hash and stamps consent_at. Re-subscribing clears opted_out_at.
// A re-subscribe keeps the stored language and needs unless new ones are given. Throws on a bad zip or number.
export async function subscribe(args: {
  phoneE164: string;
  zip: string;
  language?: Language;
  needs?: CallerNeeds;
}): Promise<SubscriberRow> {
  // Zip stays text, never a number.
  if (!/^\d{5}$/.test(args.zip)) throw new Error('subscribe: the zip must be five digits');
  const phoneE164 = toE164(args.phoneE164);
  if (!phoneE164) throw new Error('subscribe: not a phone number');

  const phoneHash = hashPhone(phoneE164);
  const existing = await getSubscriber(phoneHash);
  // subscribers.phone_e164 is the only place a raw number is stored.
  return upsertSubscriber({
    phoneHash,
    phoneE164,
    zip: args.zip,
    language: args.language ?? existing?.language ?? 'en',
    needs: args.needs ?? existing?.needs ?? {},
    consentAt: new Date(),
  });
}

// Handles STOP: stamps opted_out_at so send_sms and the alert fan-out skip this number, and clears the stored number.
// A number with no subscriber row (a voice caller who got a one-off text) has nothing to mark: zip and consent_at
// are NOT NULL, so no row can be made for them. For those, Twilio's own STOP list is the only block: it refuses
// the send with error 21610. That covers Twilio's English keywords, not the Spanish ones above.
export async function optOut(phoneE164: string): Promise<void> {
  await setOptedOut(hashPhone(phoneE164), new Date());
}

// True when the number has a subscriber row with opted_out_at set. send_sms checks this before every send.
// No row means not opted out: a caller asking for a text mid-call is consent for that one message.
export async function isOptedOut(phoneE164: string): Promise<boolean> {
  const row = await getSubscriber(hashPhone(phoneE164));
  return row?.opted_out_at != null;
}
