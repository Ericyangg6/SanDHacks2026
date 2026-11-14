import { notImplemented } from '../todo';
import type { AlertRow, Language, Reading, Site, SiteHours, SiteResult } from '../types';

// Every outbound text body is built here so wording and language handling stay in one place.
// TODO: check segment counts once the copy settles. á, í, ó and ú are outside GSM-7, so a text containing
//       them is sent as UCS-2 (70 characters per segment instead of 160).

type Copy = Record<'en' | 'es', string>;

// TODO: add tl, vi and zh copy. They fall back to English until then.
function pick(copy: Copy, language: Language): string {
  return language === 'es' ? copy.es : copy.en;
}

// Site hours are written in local time, whatever the server's own time zone is.
const TIME_ZONE = 'America/Los_Angeles';
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

// The local calendar date (YYYY-MM-DD) and weekday (0 = Sunday) at `now`.
function localDay(now: Date): { date: string; weekday: number } {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    weekday: 'short',
  }).formatToParts(now);
  const part = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
  return { date: `${part('year')}-${part('month')}-${part('day')}`, weekday: WEEKDAYS.indexOf(part('weekday')) };
}

// "13:30" -> "1:30 PM", the format M2 uses in SiteResult.hours_today. Anything else is passed through.
function formatTime(hhmm: string): string {
  const match = /^(\d{1,2}):(\d{2})$/.exec(hhmm);
  if (!match) return hhmm;
  const hour = Number(match[1]) % 24;
  return `${hour % 12 === 0 ? 12 : hour % 12}:${match[2]} ${hour < 12 ? 'AM' : 'PM'}`;
}

// Today's hours as text ("9:00 AM - 1:00 PM, 3:00 PM - 8:00 PM"), 'closed', or 'unknown' when the site has no
// hours on file at all. An exception for today's date wins over the weekly hours.
function hoursToday(hours: SiteHours, now: Date): string | 'closed' | 'unknown' {
  const { date, weekday } = localDay(now);
  const exception = hours.exceptions?.find((e) => e.date === date);
  if (exception?.closed) return 'closed';
  if (exception?.open && exception.close) return `${formatTime(exception.open)} - ${formatTime(exception.close)}`;
  if (hours.weekly.length === 0) return 'unknown';

  const intervals = hours.weekly.filter((i) => i.day === weekday).sort((a, b) => a.open.localeCompare(b.open));
  if (intervals.length === 0) return 'closed';
  return intervals.map((i) => `${formatTime(i.open)} - ${formatTime(i.close)}`).join(', ');
}

function hoursLine(hours: SiteHours, now: Date, language: Language): string {
  const today = hoursToday(hours, now);
  if (today === 'closed') return pick({ en: 'Closed today', es: 'Cerrado hoy' }, language);
  if (today === 'unknown') {
    return pick({ en: 'Hours not confirmed. Call ahead.', es: 'Horario sin confirmar. Llama antes.' }, language);
  }
  return pick({ en: `Hours today: ${today}`, es: `Horario de hoy: ${today}` }, language);
}

// Mock readings are labelled so a made-up number is never read as a real one.
function aqiLine(reading: Reading | null, language: Language): string | null {
  if (reading?.aqi == null) return null;
  const label = reading.source === 'mock' ? pick({ en: ' (test data)', es: ' (datos de prueba)' }, language) : '';
  return pick({ en: `Air quality (AQI): ${reading.aqi}`, es: `Calidad del aire (AQI): ${reading.aqi}` }, language) + label;
}

// Same link format as SiteResult.map_url.
function mapUrl(address: string): string {
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}`;
}

// The text for one site: name, address, hours today, AQI and map link. Used by send_sms.
// A discovered site is never presented as an official cooling center and always carries "call ahead".
export function siteMessage(args: { site: Site; reading: Reading | null; language: Language; now?: Date }): string {
  const { site, language } = args;
  const lines = [`Shade: ${site.name}`, site.address, hoursLine(site.hours, args.now ?? new Date(), language)];

  const aqi = aqiLine(args.reading, language);
  if (aqi) lines.push(aqi);

  if (site.tier === 'discovered') {
    const phone = site.phone ? `: ${site.phone}` : '';
    lines.push(
      pick(
        {
          en: `Not an official cooling center. Call ahead to confirm it is open${phone}.`,
          es: `No es un centro de enfriamiento oficial. Llama antes para confirmar que está abierto${phone}.`,
        },
        language,
      ),
    );
  }

  // Last, on its own line, so no punctuation ends up inside the link.
  lines.push(pick({ en: 'Map: ', es: 'Mapa: ' }, language) + mapUrl(site.address));
  return lines.join('\n');
}

// The text sent to a subscriber when an alert covers their zip. `site` is the nearest open site, or null.
export function alertMessage(args: { alert: AlertRow; site: SiteResult | null; language: Language }): string {
  // TODO: 1. Opening line per alert.kind (extreme_heat_warning, heat_advisory, air_quality_alert) in en and es.
  //          kind 'mock' must say it is a test. alert.headline is English NWS text: do not paste it into es.
  // TODO: 2. Add "until <time>" from alert.expires_at when set, formatted in America/Los_Angeles.
  // TODO: 3. With a site: name, address, site.hours_today, site.aqi when not null, site.map_url, and
  //          "call ahead" when site.call_ahead is true.
  // TODO: 4. Without a site: say no open site was found nearby and point to 211.
  // TODO: 5. Close with an invitation to reply with questions and "Reply STOP to cancel".
  return notImplemented('templates.alertMessage');
}

// Sent once, right after consent_at is recorded.
export function optInConfirmation(language: Language): string {
  return pick(
    {
      en: 'Shade: you are signed up for heat and smoke alerts in San Diego. Message frequency varies. Msg & data rates may apply. Reply HELP for help or STOP to cancel.',
      es: 'Shade: te suscribiste a las alertas de calor y humo en San Diego. La frecuencia de los mensajes varía. Pueden aplicarse tarifas de mensajes y datos. Responde HELP para ayuda o STOP para cancelar.',
    },
    language,
  );
}

// Sent once in reply to STOP.
export function optOutConfirmation(language: Language): string {
  return pick(
    {
      en: 'Shade: you are unsubscribed and will not get any more texts. Reply START to sign up again.',
      es: 'Shade: cancelaste tu suscripción y no recibirás más mensajes. Responde START para volver a suscribirte.',
    },
    language,
  );
}

// Reply to HELP.
export function helpMessage(language: Language): string {
  return pick(
    {
      en: 'Shade: heat and smoke alerts with the nearest open cooling center in San Diego. Reply with a question, or STOP to cancel. Call 211 for free rides. In an emergency, call 911.',
      es: 'Shade: alertas de calor y humo con el centro de enfriamiento abierto más cercano en San Diego. Responde con una pregunta, o STOP para cancelar. Llama al 211 para transporte gratis. En una emergencia, llama al 911.',
    },
    language,
  );
}

// Opens the text agent's first reply in a conversation.
export function aiDisclosure(language: Language): string {
  return pick(
    {
      en: 'You are texting with Shade, an automated AI assistant, not a person. In an emergency, call 911.',
      es: 'Estás escribiendo con Shade, un asistente automático de inteligencia artificial, no una persona. En una emergencia, llama al 911.',
    },
    language,
  );
}
