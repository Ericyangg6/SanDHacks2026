import { notImplemented } from './todo';
import type {
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

// Data access for M4. Every function is a stub until the team settles on a shared Neon client
// (connection string: env.databaseUrl()).
// M4 writes subscribers, alerts, messages and its own calls rows. sites and readings are read-only here.

// ---- subscribers ----

export interface UpsertSubscriberInput {
  phoneHash: string;
  phoneE164: string; // stored in subscribers.phone_e164 so alerts have a number to send to
  zip: string;
  language: Language;
  needs?: CallerNeeds;
  consentAt: Date;
}

export async function getSubscriber(phoneHash: string): Promise<SubscriberRow | null> {
  return notImplemented('db.getSubscriber');
}

// Keyed on phone_hash. Re-subscribing clears opted_out_at, refreshes consent_at and stores phone_e164 again.
export async function upsertSubscriber(input: UpsertSubscriberInput): Promise<SubscriberRow> {
  return notImplemented('db.upsertSubscriber');
}

// Stamps opted_out_at and sets phone_e164 to null: the raw number is kept only while the opt-in stands.
// The row and its phone_hash stay, so send_sms can still refuse the number.
export async function setOptedOut(phoneHash: string, at: Date): Promise<void> {
  return notImplemented('db.setOptedOut');
}

// Only rows with opted_out_at null and phone_e164 not null.
export async function listActiveSubscribersByZips(zips: string[]): Promise<SubscriberContact[]> {
  return notImplemented('db.listActiveSubscribersByZips');
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
  return notImplemented('db.getAlertByNwsId');
}

export async function insertAlert(alert: NewAlert): Promise<AlertRow> {
  return notImplemented('db.insertAlert');
}

export async function addTextsSent(alertId: number, count: number): Promise<void> {
  return notImplemented('db.addTextsSent');
}

// ---- messages (text agent memory) ----

export interface NewMessage {
  phoneHash: string;
  role: 'user' | 'assistant';
  body: string;
}

// Oldest first, capped at `limit`.
export async function listRecentMessages(phoneHash: string, limit = 20): Promise<MessageRow[]> {
  return notImplemented('db.listRecentMessages');
}

export async function insertMessage(message: NewMessage): Promise<MessageRow> {
  return notImplemented('db.insertMessage');
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

export async function insertCall(call: NewCall): Promise<{ id: number }> {
  return notImplemented('db.insertCall');
}

// Guards against texting the same subscriber twice for one alert.
export async function hasAlertText(phoneHash: string, alertId: number): Promise<boolean> {
  return notImplemented('db.hasAlertText');
}

// Cooldown guard: true when the subscriber was sent a text for any alert of this kind at or after `since`.
// Reads calls joined to alerts on alert_id (outcome 'sms_sent', alerts.kind = kind). No schema change needed.
export async function hasRecentAlertText(phoneHash: string, kind: AlertKind, since: Date): Promise<boolean> {
  return notImplemented('db.hasRecentAlertText');
}

// ---- read-only (M2 writes these) ----

export async function getSite(siteId: number): Promise<Site | null> {
  return notImplemented('db.getSite');
}

export async function getLatestReading(zip: string): Promise<Reading | null> {
  return notImplemented('db.getLatestReading');
}
