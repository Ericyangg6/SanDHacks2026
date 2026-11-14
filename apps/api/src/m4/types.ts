// Shared contract types from data/schema/types.ts. M4 imports them from here so the path lives in one place.
import type {
  AlertChannel,
  AlertKind,
  CallDirection,
  CallOutcome,
  CallerNeeds,
  Channel,
  Language,
} from '../../../../data/schema/types';

export type {
  AlertChannel,
  AlertKind,
  CallDirection,
  CallOutcome,
  CallerNeeds,
  Channel,
  FindSitesInput,
  FindSitesOutput,
  Language,
  Reading,
  SendSmsInput,
  SendSmsOutput,
  Site,
  SiteHours,
  SiteResult,
} from '../../../../data/schema/types';

export const LANGUAGES = ['en', 'es', 'tl', 'vi', 'zh'] as const satisfies readonly Language[];

// Row types for the tables M4 writes. They mirror data/schema/schema.sql, which has no TypeScript types for them yet.

export interface SubscriberRow {
  id: number;
  phone_hash: string;
  // The one raw number at rest: alerts need somewhere to send. Null once the subscriber opts out.
  // Every other table, and every log line, uses phone_hash.
  phone_e164: string | null;
  language: Language;
  zip: string;
  needs: CallerNeeds;
  consent_at: string;
  opted_out_at: string | null;
  // Where alerts go: the channel they opted in on. null = SMS, and every row reads null on a database that does
  // not have the column yet.
  alert_channel: AlertChannel | null;
  // Messenger subscribers only: the page-scoped id and the Page it wrote to, kept so an alert can be sent.
  // Like phone_e164, null once they opt out, and never logged. phone_hash holds hashMessengerId(psid).
  messenger_psid: string | null;
  messenger_page_id: string | null;
}

// An opted-in SMS or WhatsApp subscriber, whose number is still on file.
export interface SubscriberContact extends SubscriberRow {
  phone_e164: string;
}

// An opted-in Messenger subscriber, whose Messenger ids are still on file.
export interface MessengerContact extends SubscriberRow {
  alert_channel: 'messenger';
  messenger_psid: string;
  messenger_page_id: string;
}

export function isMessengerContact(row: SubscriberRow): row is MessengerContact {
  return row.alert_channel === 'messenger' && !!row.messenger_psid && !!row.messenger_page_id;
}

export interface AlertRow {
  id: number;
  kind: AlertKind;
  nws_id: string | null;
  zips: string[];
  headline: string | null;
  onset_at: string | null;
  expires_at: string | null;
  detected_at: string;
  texts_sent: number;
}

export interface MessageRow {
  id: number;
  phone_hash: string;
  role: 'user' | 'assistant';
  body: string;
  created_at: string;
}

export interface CallRow {
  id: number;
  direction: CallDirection;
  channel: Channel;
  phone_hash: string | null;
  zip: string | null;
  language: string | null;
  site_id: number | null;
  outcome: CallOutcome | null;
  alert_id: number | null;
  started_at: string;
  ended_at: string | null;
}
