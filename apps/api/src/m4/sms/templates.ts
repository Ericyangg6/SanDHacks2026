import type { AlertKind, AlertRow, Language, Reading, Site, SiteHours, SiteResult } from '../types';

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

  const label = siteSourceLabel(site);
  if (label) {
    lines.push(evidenceLine({ source_label: label, hours_verified_at: site.last_verified_at, evidence: site.evidence, live_checked: false } as SiteResult, language)!);
  }

  // Last, on its own line, so no punctuation ends up inside the link.
  lines.push(pick({ en: 'Map: ', es: 'Mapa: ' }, language) + mapUrl(site.address));
  return lines.join('\n');
}

const ALERT_NAMES: Record<Exclude<AlertKind, 'mock'>, Copy> = {
  extreme_heat_warning: { en: 'Extreme Heat Warning', es: 'Advertencia de calor extremo' },
  heat_advisory: { en: 'Heat Advisory', es: 'Aviso de calor' },
  air_quality_alert: { en: 'Air Quality Alert', es: 'Alerta de calidad del aire' },
  high_heat_index: { en: 'Dangerous heat', es: 'Calor peligroso' },
  high_aqi: { en: 'Unhealthy air', es: 'Aire no saludable' },
};

// "Sun 8:00 PM" / "dom, 8:00 p. m.", in local time.
function localDayTime(iso: string, language: Language): string {
  return new Intl.DateTimeFormat(language === 'es' ? 'es-US' : 'en-US', {
    timeZone: TIME_ZONE,
    weekday: 'short',
    hour: 'numeric',
    minute: '2-digit',
  }).format(new Date(iso));
}

function alertOpening(alert: AlertRow, language: Language): string {
  if (alert.kind === 'mock') {
    return pick(
      {
        en: 'Shade TEST: this is a practice alert, not a real weather warning.',
        es: 'Shade PRUEBA: esta es una alerta de práctica, no una advertencia real del clima.',
      },
      language,
    );
  }
  // Raised from our own readings: say what was measured. The headline carries the value ("Heat index 105°F in
  // 92105 ...", "AQI 165 in 92105 ..."); only the number is taken from it.
  if (alert.kind === 'high_heat_index' || alert.kind === 'high_aqi') {
    const value = /\d+/.exec(alert.headline ?? '')?.[0];
    if (alert.kind === 'high_heat_index') {
      return pick(
        {
          en: `Shade: it is dangerously hot in your area right now${value ? ` (heat index ${value}°F)` : ''}.`,
          es: `Shade: hace un calor peligroso en tu zona ahora${value ? ` (índice de calor ${value}°F)` : ''}.`,
        },
        language,
      );
    }
    return pick(
      {
        en: `Shade: the air in your area is unhealthy right now${value ? ` (AQI ${value})` : ''}.`,
        es: `Shade: el aire en tu zona no es saludable ahora${value ? ` (AQI ${value})` : ''}.`,
      },
      language,
    );
  }
  // alert.headline is English NWS text, so it is never pasted in: the name per kind is enough.
  const name = pick(ALERT_NAMES[alert.kind], language);
  // Spanish times end in "p.m.", which already closes the sentence.
  const until = alert.expires_at ? localDayTime(alert.expires_at, language).replace(/\.$/, '') : null;
  return pick(
    {
      en: `Shade: ${name} for your area${until ? ` until ${until}` : ''}.`,
      es: `Shade: ${name} en tu zona${until ? ` hasta el ${until}` : ''}.`,
    },
    language,
  );
}

// "Hours verified Nov 14 from the county's Cool Zone list: "Monday 10:00AM - 6:00PM"". The quote is the exact text the
// hours came from, trimmed to one short fragment. Null when find_sites gave no source, so nothing is made up.
export function evidenceLine(site: SiteResult, language: Language): string | null {
  if (!site.source_label || !site.hours_verified_at) return null;
  const when = new Intl.DateTimeFormat(language === 'es' ? 'es-US' : 'en-US', { timeZone: TIME_ZONE, month: 'short', day: 'numeric' }).format(new Date(site.hours_verified_at));
  const verb = site.live_checked
    ? pick({ en: `Checked just now, no closure notice. Hours verified ${when}`, es: `Revisado hace un momento, sin aviso de cierre. Horario verificado el ${when}` }, language)
    : pick({ en: `Hours verified ${when}`, es: `Horario verificado el ${when}` }, language);
  const from = pick({ en: 'from', es: 'en' }, language);
  const quote = site.evidence?.replace(/\s+/g, ' ').split(/\s*\.{3}\s*/).find((f) => /\d/.test(f))?.trim().slice(0, 90);
  return `${verb} ${from} ${site.source_label}${quote ? `: "${quote}"` : '.'}`;
}

function siteSourceLabel(site: Site): string | null {
  if (!/^https?:/.test(site.source_url) || /google\.[a-z.]+\/maps/.test(site.source_url)) return null;
  try { return `the page at ${new URL(site.source_url).hostname.replace(/^www\./, '')}`; } catch { return null; }
}

function alertSiteLines(alert: AlertRow, site: SiteResult, language: Language): string[] {
  const smoke = alert.kind === 'air_quality_alert' || alert.kind === 'high_aqi';
  const discovered = site.tier === 'discovered';
  const label = pick(
    smoke
      ? discovered
        ? {
            en: 'Nearest open indoor space (not an official site, call ahead):',
            es: 'Espacio interior abierto más cercano (no es un sitio oficial, llama antes):',
          }
        : { en: 'Nearest open indoor space:', es: 'Espacio interior abierto más cercano:' }
      : discovered
        ? {
            en: 'Nearest open place to cool off (not an official cooling center, call ahead):',
            es: 'Lugar abierto más cercano para refrescarte (no es un centro oficial, llama antes):',
          }
        : { en: 'Nearest open cooling center:', es: 'Centro de enfriamiento abierto más cercano:' },
    language,
  );

  const lines = [label, `${site.name}, ${site.address}`];
  lines.push(pick({ en: `Hours today: ${site.hours_today}`, es: `Horario de hoy: ${site.hours_today}` }, language));
  if (site.aqi != null) {
    lines.push(pick({ en: `Air quality (AQI) there: ${site.aqi}`, es: `Calidad del aire (AQI) allí: ${site.aqi}` }, language));
  }
  // An official site that still says call ahead (M2 sets call_ahead) gets the line too.
  if (site.call_ahead && site.tier !== 'discovered') {
    lines.push(pick({ en: 'Call ahead to confirm it is open.', es: 'Llama antes para confirmar que está abierto.' }, language));
  }
  const proof = evidenceLine(site, language);
  if (proof) lines.push(proof);
  lines.push(site.map_url);
  return lines;
}

// The text sent to a subscriber when an alert covers their zip. `site` is the nearest open site, or null.
export function alertMessage(args: { alert: AlertRow; site: SiteResult | null; language: Language }): string {
  const { alert, site, language } = args;
  const lines = [alertOpening(alert, language)];
  if (site) {
    lines.push(...alertSiteLines(alert, site, language));
  } else {
    lines.push(
      pick(
        {
          en: 'We could not find an open site near you right now. Call 211 for help finding one, or for a free ride.',
          es: 'No encontramos un lugar abierto cerca de ti ahora. Llama al 211 para encontrar uno o pedir transporte gratis.',
        },
        language,
      ),
    );
  }
  lines.push(
    pick(
      {
        en: 'Reply with questions (no car? need closer?), or STOP to cancel. In an emergency, call 911.',
        es: 'Responde con tus preguntas (¿sin carro? ¿algo más cerca?), o STOP para cancelar. En una emergencia, llama al 911.',
      },
      language,
    ),
  );
  return lines.join('\n');
}

// Values for the approved WhatsApp alert template, sent when a WhatsApp subscriber last wrote more than 24
// hours ago. The template itself lives in Twilio's Content Template Builder, approved by Meta. Its text should be:
//   en: Shade alert: {{1}} Nearest open cooling site: {{2}}. Hours today: {{3}}. Map: {{4}}
//       Reply with questions, or STOP to opt out. In an emergency, call 911.
//   es: Alerta de Shade: {{1}} Lugar fresco abierto más cercano: {{2}}. Horario de hoy: {{3}}. Mapa: {{4}}
//       Responde con tus preguntas, o STOP para cancelar. En una emergencia, llama al 911.
// WhatsApp refuses template values with line breaks, so each value is one line.
export function whatsAppAlertVariables(args: {
  alert: AlertRow;
  site: SiteResult | null;
  language: Language;
}): Record<string, string> {
  const { alert, site, language } = args;
  const oneLine = (text: string) => text.replace(/\s+/g, ' ').trim();
  return {
    // The opening without its "Shade:" lead, which the template already says.
    '1': oneLine(alertOpening(alert, language).replace(/^Shade:?\s*/, '')),
    '2': oneLine(
      site
        ? `${site.name}, ${site.address}`
        : pick({ en: 'none open near you right now, call 211', es: 'ninguno abierto cerca ahora, llama al 211' }, language),
    ),
    '3': oneLine(site?.hours_today ?? '-'),
    '4': oneLine(site?.map_url ?? '211'),
  };
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

// Reply to JOIN with no zip, and to START from a number that never signed up.
export function joinUsage(language: Language): string {
  return pick(
    {
      en: 'Shade: to get heat and smoke alerts for your area, reply JOIN and your zip code. Example: JOIN 92105',
      es: 'Shade: para recibir alertas de calor y humo en tu zona, responde JOIN y tu código postal. Ejemplo: JOIN 92105',
    },
    language,
  );
}

// Sent when a text could not be handled, so the person is never left with silence.
export function replyUnavailable(language: Language): string {
  return pick(
    {
      en: 'Shade: something went wrong on our side and we could not handle your text. Please try again in a few minutes. For a cooling center or a free ride, call 211. In an emergency, call 911.',
      es: 'Shade: algo falló de nuestro lado y no pudimos procesar tu mensaje. Intenta de nuevo en unos minutos. Para un centro de enfriamiento o transporte gratis, llama al 211. En una emergencia, llama al 911.',
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

// ---- Facebook Messenger ----
// Messenger is Shade's main channel: people sign up for alerts here with JOIN <zip>. Facebook only lets a Page
// message someone within 24 hours of their last message, so the opt-in says so plainly.

// Reply to JOIN with no zip, and to START from someone who never signed up.
export function messengerJoinUsage(language: Language): string {
  return pick(
    {
      en: 'Shade: to get heat and smoke alerts here, send JOIN, your zip code and your phone number. Example: JOIN 92105 6195551234 (the phone number is optional)',
      es: 'Shade: para recibir alertas de calor y humo aquí, envía JOIN, tu código postal y tu número de teléfono. Ejemplo: JOIN 92105 6195551234 (el teléfono es opcional)',
    },
    language,
  );
}

// Reply to a Messenger JOIN whose phone number could not be read. Nothing is saved.
export function messengerPhoneInvalid(language: Language): string {
  return pick(
    {
      en: 'Shade: that phone number does not look right. Send JOIN, your zip code and your 10-digit phone number. Example: JOIN 92105 6195551234',
      es: 'Shade: ese número de teléfono no parece correcto. Envía JOIN, tu código postal y tu número de 10 dígitos. Ejemplo: JOIN 92105 6195551234',
    },
    language,
  );
}

// Sent once, right after a Messenger opt-in is recorded. `phoneLast4` is set when this JOIN linked a phone number,
// `name` when one was given; the phone itself is never repeated back in full.
export function messengerOptInConfirmation(
  language: Language,
  zip: string,
  extra: { phoneLast4?: string | null; name?: string | null } = {},
): string {
  const firstName = extra.name?.split(' ')[0];
  const greeting = firstName ? `${firstName}, ` : '';
  const linked = extra.phoneLast4
    ? pick(
        {
          en: ` Your profile is linked to the phone number ending in ${extra.phoneLast4}.`,
          es: ` Tu perfil está vinculado al número que termina en ${extra.phoneLast4}.`,
        },
        language,
      )
    : '';
  return pick(
    {
      en: `Shade: ${greeting}you are signed up for heat and smoke alerts for ${zip} here on Messenger.${linked} Facebook only lets us message you within 24 hours of your last message, so write to us now and then to keep alerts coming. Send STOP to cancel.`,
      es: `Shade: ${greeting}te suscribiste a las alertas de calor y humo para ${zip} aquí en Messenger.${linked} Facebook solo nos deja escribirte dentro de las 24 horas de tu último mensaje, así que escríbenos de vez en cuando para seguir recibiendo alertas. Envía STOP para cancelar.`,
    },
    language,
  );
}

// Reply to STOP on Messenger.
export function messengerStopConfirmation(language: Language): string {
  return pick(
    {
      en: 'Shade: you are unsubscribed from alerts and will not get any more here. You can still ask us questions any time. Send START to sign up again.',
      es: 'Shade: cancelaste tu suscripción y no recibirás más alertas aquí. Puedes seguir haciéndonos preguntas cuando quieras. Envía START para volver a suscribirte.',
    },
    language,
  );
}

// Reply to HELP on Messenger, and to a message with no words.
export function messengerHelpMessage(language: Language): string {
  return pick(
    {
      en: 'Shade: ask us for the nearest open cooling center in San Diego. Send JOIN and your zip code for heat and smoke alerts here, or STOP to cancel them. Call 211 for free rides. In an emergency, call 911.',
      es: 'Shade: pregúntanos por el centro de enfriamiento abierto más cercano en San Diego. Envía JOIN y tu código postal para recibir alertas de calor y humo aquí, o STOP para cancelarlas. Llama al 211 para transporte gratis. En una emergencia, llama al 911.',
    },
    language,
  );
}

// First line of a follow-up held after a phone call (messenger/followups.ts), above the site details.
export function followupIntro(language: Language): string {
  return pick({ en: 'From your call with Shade:', es: 'De tu llamada con Shade:' }, language);
}
