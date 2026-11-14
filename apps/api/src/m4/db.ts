import { env } from './env';
import type {
  AlertChannel,
  AlertKind,
  AlertRow,
  CallDirection,
  CallOutcome,
  CallerNeeds,
  Channel,
  Language,
  MessageRow,
  Reading,
  Site,
  SubscriberContact,
  SubscriberRow,
} from './types';

// Data access for M4, over Neon's HTTPS query endpoint: one fetch per statement, with no driver and no pool,
// so the app needs no Postgres package. Swap `query` for a shared client if the team adds one.
// M4 writes subscribers, alerts, messages and its own calls rows. sites and readings are read-only here.

const DB_TIMEOUT_MS = 10_000;

// A failed statement. `code` is the Postgres SQLSTATE when the database returned one (23505 = unique violation).
export class DbError extends Error {
  constructor(
    message: string,
    readonly code: string | null,
  ) {
    super(message);
    this.name = 'DbError';
  }
}

// Runs one statement. Values go in `params` ($1, $2, ...), never into the SQL text. Parameters arrive as text,
// so anything that is not text needs a cast in the statement ($1::int, $2::timestamptz, $3::alert_kind).
async function query<Row>(sql: string, params: unknown[] = []): Promise<Row[]> {
  const url = env.databaseUrl();
  let response: Response;
  try {
    response = await fetch(`https://${new URL(url).hostname}/sql`, {
      method: 'POST',
      headers: { 'Neon-Connection-String': url, 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: sql, params }),
      signal: AbortSignal.timeout(DB_TIMEOUT_MS),
    });
  } catch (error) {
    throw new DbError(`Database request failed: ${error instanceof Error ? error.name : 'unknown error'}`, null);
  }

  const payload = (await response.json().catch(() => null)) as {
    rows?: Row[];
    message?: unknown;
    code?: unknown;
  } | null;
  if (!response.ok || !Array.isArray(payload?.rows)) {
    // Only Postgres's message is kept: its `detail` field can quote the values of the offending row.
    const message = typeof payload?.message === 'string' ? payload.message : `HTTP ${response.status}`;
    throw new DbError(message, typeof payload?.code === 'string' ? payload.code : null);
  }
  return payload.rows;
}

// The endpoint returns timestamptz in Postgres's own text format, so every timestamp is selected as ISO 8601.
function iso(column: string): string {
  return `to_char("${column}" at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as "${column}"`;
}

// A text[] parameter, passed as a JSON string.
function textArray(placeholder: string): string {
  return `array(select jsonb_array_elements_text(${placeholder}::jsonb))`;
}

const SUBSCRIBER_COLUMNS_BEFORE_ALERT_CHANNEL = `id, phone_hash, phone_e164, language, zip, needs, ${iso('consent_at')}, ${iso('opted_out_at')}`;
const SUBSCRIBER_COLUMNS = `${SUBSCRIBER_COLUMNS_BEFORE_ALERT_CHANNEL}, alert_channel`;
const ALERT_COLUMNS = `id, kind, nws_id, zips, headline, ${iso('onset_at')}, ${iso('expires_at')}, ${iso('detected_at')}, texts_sent`;
const MESSAGE_COLUMNS = `id, phone_hash, role, body, ${iso('created_at')}`;
const SITE_COLUMNS = `id, name, kind, tier, confidence, address, zip, lat, lon, hours, hours_confirmed_on_source,
  has_ac, has_filtration, capacity_est, phone, source_url, ${iso('last_verified_at')}`;

// ---- subscribers ----

// Postgres's code for a column that does not exist.
const UNDEFINED_COLUMN = '42703';

function isMissingColumn(error: unknown): boolean {
  return error instanceof DbError && error.code === UNDEFINED_COLUMN;
}

// subscribers.alert_channel is newer than some databases. Until
// `alter table subscribers add column alert_channel text check (alert_channel in ('sms', 'whatsapp'))` has run,
// a read is retried without the column and every row comes back as SMS, so SMS keeps working.
async function withAlertChannel<Row extends SubscriberRow>(run: (columns: string) => Promise<Row[]>): Promise<Row[]> {
  try {
    return await run(SUBSCRIBER_COLUMNS);
  } catch (error) {
    if (!isMissingColumn(error)) throw error;
    const rows = await run(SUBSCRIBER_COLUMNS_BEFORE_ALERT_CHANNEL);
    return rows.map((row) => ({ ...row, alert_channel: null }));
  }
}

export interface UpsertSubscriberInput {
  phoneHash: string;
  phoneE164: string; // stored in subscribers.phone_e164 so alerts have a number to send to
  zip: string;
  language: Language;
  needs?: CallerNeeds;
  consentAt: Date;
  alertChannel?: AlertChannel; // the channel they opted in on. Default 'sms'
}

export async function getSubscriber(phoneHash: string): Promise<SubscriberRow | null> {
  const rows = await withAlertChannel((columns) =>
    query<SubscriberRow>(`select ${columns} from subscribers where phone_hash = $1`, [phoneHash]),
  );
  return rows[0] ?? null;
}

// Keyed on phone_hash. Re-subscribing clears opted_out_at, refreshes consent_at, stores phone_e164 again and
// moves alerts to the channel of this opt-in ('sms' is stored as null).
// On a database without subscribers.alert_channel, an SMS opt-in is written without the column. A WhatsApp
// opt-in throws instead: written without it, it would become an SMS subscription nobody agreed to.
export async function upsertSubscriber(input: UpsertSubscriberInput): Promise<SubscriberRow> {
  const alertChannel = input.alertChannel === 'whatsapp' ? 'whatsapp' : null;
  const params = [
    input.phoneHash,
    input.phoneE164,
    input.zip,
    input.language,
    JSON.stringify(input.needs ?? {}),
    input.consentAt.toISOString(),
  ];
  try {
    const rows = await query<SubscriberRow>(
      `insert into subscribers (phone_hash, phone_e164, zip, language, needs, consent_at, opted_out_at, alert_channel)
       values ($1, $2, $3, $4, $5::jsonb, $6::timestamptz, null, $7)
       on conflict (phone_hash) do update set
         phone_e164 = excluded.phone_e164, zip = excluded.zip, language = excluded.language,
         needs = excluded.needs, consent_at = excluded.consent_at, opted_out_at = null,
         alert_channel = excluded.alert_channel
       returning ${SUBSCRIBER_COLUMNS}`,
      [...params, alertChannel],
    );
    return rows[0];
  } catch (error) {
    if (!isMissingColumn(error) || alertChannel) throw error;
  }
  const rows = await query<SubscriberRow>(
    `insert into subscribers (phone_hash, phone_e164, zip, language, needs, consent_at, opted_out_at)
     values ($1, $2, $3, $4, $5::jsonb, $6::timestamptz, null)
     on conflict (phone_hash) do update set
       phone_e164 = excluded.phone_e164, zip = excluded.zip, language = excluded.language,
       needs = excluded.needs, consent_at = excluded.consent_at, opted_out_at = null
     returning ${SUBSCRIBER_COLUMNS_BEFORE_ALERT_CHANNEL}`,
    params,
  );
  return { ...rows[0], alert_channel: null };
}

// Stamps opted_out_at and sets phone_e164 to null: the raw number is kept only while the opt-in stands.
// The row and its phone_hash stay, so send_sms can still refuse the number. A repeated STOP keeps the first date.
export async function setOptedOut(phoneHash: string, at: Date): Promise<void> {
  await query(
    `update subscribers set opted_out_at = coalesce(opted_out_at, $2::timestamptz), phone_e164 = null
     where phone_hash = $1`,
    [phoneHash, at.toISOString()],
  );
}

// Only rows with opted_out_at null and phone_e164 not null.
export async function listActiveSubscribersByZips(zips: string[]): Promise<SubscriberContact[]> {
  if (zips.length === 0) return [];
  return withAlertChannel((columns) =>
    query<SubscriberContact>(
      `select ${columns} from subscribers
       where opted_out_at is null and phone_e164 is not null and zip = any(${textArray('$1')})
       order by id`,
      [JSON.stringify(zips)],
    ),
  );
}

// ---- alerts ----

export interface NewAlert {
  kind: AlertKind;
  nwsId: string | null; // null for mock alerts
  zips: string[];
  headline?: string | null;
  onsetAt?: Date | null;
  expiresAt?: Date | null;
}

export async function getAlertByNwsId(nwsId: string): Promise<AlertRow | null> {
  const rows = await query<AlertRow>(`select ${ALERT_COLUMNS} from alerts where nws_id = $1`, [nwsId]);
  return rows[0] ?? null;
}

// Throws DbError with code 23505 when an alert with the same nws_id already exists.
export async function insertAlert(alert: NewAlert): Promise<AlertRow> {
  const rows = await query<AlertRow>(
    `insert into alerts (kind, nws_id, zips, headline, onset_at, expires_at)
     values ($1::alert_kind, $2, ${textArray('$3')}, $4, $5::timestamptz, $6::timestamptz)
     returning ${ALERT_COLUMNS}`,
    [
      alert.kind,
      alert.nwsId,
      JSON.stringify(alert.zips),
      alert.headline ?? null,
      alert.onsetAt?.toISOString() ?? null,
      alert.expiresAt?.toISOString() ?? null,
    ],
  );
  return rows[0];
}

export async function addTextsSent(alertId: number, count: number): Promise<void> {
  await query(`update alerts set texts_sent = texts_sent + $2::int where id = $1::int`, [alertId, count]);
}

// ---- messages (text agent memory) ----

export interface NewMessage {
  phoneHash: string;
  role: 'user' | 'assistant';
  body: string;
}

// Oldest first, capped at `limit`.
export async function listRecentMessages(phoneHash: string, limit = 20): Promise<MessageRow[]> {
  return query<MessageRow>(
    `select ${MESSAGE_COLUMNS} from (
       select * from messages where phone_hash = $1 order by id desc limit $2::int
     ) recent
     order by id`,
    [phoneHash, limit],
  );
}

export async function insertMessage(message: NewMessage): Promise<MessageRow> {
  const rows = await query<MessageRow>(
    `insert into messages (phone_hash, role, body) values ($1, $2, $3) returning ${MESSAGE_COLUMNS}`,
    [message.phoneHash, message.role, message.body],
  );
  return rows[0];
}

// ---- calls (M4 rows only: outbound and sms) ----

export interface NewCall {
  direction: CallDirection;
  channel: Channel;
  phoneHash: string | null;
  zip?: string | null;
  language?: Language | null;
  siteId?: number | null;
  outcome?: CallOutcome | null;
  alertId?: number | null;
}

// A text has no duration, so ended_at equals started_at. site_id is stored only when that site has a row:
// the find_sites stand-in returns a site that does not, and a missing site must not cost us the log row.
export async function insertCall(call: NewCall): Promise<{ id: number }> {
  const rows = await query<{ id: number }>(
    `insert into calls (direction, channel, phone_hash, zip, language, site_id, outcome, alert_id, ended_at)
     values ($1::call_direction, $2::channel, $3, $4, $5, (select id from sites where id = $6::int),
             $7::call_outcome, $8::int, now())
     returning id`,
    [
      call.direction,
      call.channel,
      call.phoneHash,
      call.zip ?? null,
      call.language ?? null,
      call.siteId ?? null,
      call.outcome ?? null,
      call.alertId ?? null,
    ],
  );
  return rows[0];
}

// Guards against texting the same subscriber twice for one alert.
export async function hasAlertText(phoneHash: string, alertId: number): Promise<boolean> {
  const rows = await query(
    `select 1 from calls where phone_hash = $1 and alert_id = $2::int and outcome = 'sms_sent' limit 1`,
    [phoneHash, alertId],
  );
  return rows.length > 0;
}

// When this number last wrote to us on `channel`, from the inbound calls rows, or null when it never has.
// WhatsApp allows free-form messages for 24 hours after that; later ones need an approved template.
export async function lastInboundAt(phoneHash: string, channel: Channel): Promise<Date | null> {
  const rows = await query<{ at: string | null }>(
    `select to_char(max(started_at) at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as at from calls
     where phone_hash = $1 and direction = 'inbound' and channel = $2::channel`,
    [phoneHash, channel],
  );
  return rows[0]?.at ? new Date(rows[0].at) : null;
}

// Cooldown guard: true when the subscriber was sent a text for any alert of this kind at or after `since`.
// Reads calls joined to alerts on alert_id (outcome 'sms_sent', alerts.kind = kind). No schema change needed.
export async function hasRecentAlertText(phoneHash: string, kind: AlertKind, since: Date): Promise<boolean> {
  const rows = await query(
    `select 1 from calls c join alerts a on a.id = c.alert_id
     where c.phone_hash = $1 and c.outcome = 'sms_sent' and a.kind = $2::alert_kind
       and c.started_at >= $3::timestamptz
     limit 1`,
    [phoneHash, kind, since.toISOString()],
  );
  return rows.length > 0;
}

// ---- read-only (M2 writes these) ----

export async function getSite(siteId: number): Promise<Site | null> {
  const rows = await query<Site>(`select ${SITE_COLUMNS} from sites where id = $1::int`, [siteId]);
  return rows[0] ?? null;
}

// How old a reading can be and still be quoted in a text as the air quality right now.
const READING_MAX_AGE_HOURS = 3;

// The newest reading for the zip that carries an AQI, which is the only field M4 puts in a text.
// Null when there is none from the last READING_MAX_AGE_HOURS.
export async function getLatestReading(zip: string): Promise<Reading | null> {
  const rows = await query<Reading>(
    `select ${iso('time')}, zip, temp_f, heat_index, aqi, source from readings
     where zip = $1 and aqi is not null and readings."time" >= now() - make_interval(hours => $2::int)
     order by readings."time" desc
     limit 1`,
    [zip, READING_MAX_AGE_HOURS],
  );
  return rows[0] ?? null;
}
