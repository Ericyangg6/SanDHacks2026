// Shared contract types. Import them from here so the source path lives in one place (see ./shared-types.ts).
import type {
  AlertKind,
  CallDirection,
  CallOutcome,
  CallerNeeds,
  Channel,
  Language,
} from './shared-types';

export type {
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
} from './shared-types';

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
}

// An opted-in subscriber, whose number is still on file.
export interface SubscriberContact extends SubscriberRow {
  phone_e164: string;
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
