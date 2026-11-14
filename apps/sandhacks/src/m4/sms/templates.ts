import { notImplemented } from '../todo';
import type { AlertRow, Language, Reading, Site, SiteResult } from '../types';

// Every outbound text body is built here so wording and language handling stay in one place.
// TODO: check segment counts once the copy settles. á, í, ó and ú are outside GSM-7, so a text containing
//       them is sent as UCS-2 (70 characters per segment instead of 160).

type Copy = Record<'en' | 'es', string>;

// TODO: add tl, vi and zh copy. They fall back to English until then.
function pick(copy: Copy, language: Language): string {
  return language === 'es' ? copy.es : copy.en;
}

// The text for one site: name, address, hours today, map link and AQI. Used by send_sms.
export function siteMessage(args: { site: Site; reading: Reading | null; language: Language; now?: Date }): string {
  // TODO: 1. Resolve "today" for `args.now ?? new Date()` in America/Los_Angeles (Intl.DateTimeFormat with
  //          timeZone): the local date as YYYY-MM-DD and the weekday as 0 = Sunday ... 6 = Saturday.
  // TODO: 2. Hours today from site.hours: an exception matching the local date wins (closed, or its own
  //          open/close), otherwise every weekly interval for that weekday (there can be several).
  //          No interval means closed today.
  // TODO: 3. Format the 24h "HH:MM" values the way SiteResult.hours_today does ("9:00 AM - 8:00 PM"),
  //          or "Closed today" / "Cerrado hoy".
  // TODO: 4. Build the map link from the address, since Site has no map_url:
  //          https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(site.address)}
  //          Use the same format M2 puts in SiteResult.map_url.
  // TODO: 5. AQI line from args.reading?.aqi. Leave the line out when the reading or its aqi is null.
  // TODO: 6. For tier 'discovered', add "call ahead" and site.phone when present, matching the honesty
  //          rule behind SiteResult.call_ahead.
  // TODO: 7. Assemble name, address, hours, AQI and map link in en and es (use pick for the fallback).
  return notImplemented('templates.siteMessage');
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
