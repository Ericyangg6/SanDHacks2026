// Shared TypeScript types. Mirrors schema.sql and contracts.md.
// Import these; don't redefine them locally.

export type SiteKind =
  | 'cool_zone' | 'library' | 'rec_center' | 'community_center'
  | 'senior_center' | 'mall' | 'other';
export type SiteTier = 'official' | 'discovered';
export type Language = 'en' | 'es' | 'tl' | 'vi' | 'zh';
export type Channel = 'voice' | 'sms';
export type CallDirection = 'inbound' | 'outbound';
export type CallOutcome =
  | 'site_given' | 'sms_sent' | 'no_site_found' | 'escalated_911' | 'abandoned' | 'error';
export type AlertKind = 'extreme_heat_warning' | 'heat_advisory' | 'air_quality_alert' | 'mock';

/** Times are 24h "HH:MM" in America/Los_Angeles. day: 0 = Sunday ... 6 = Saturday. */
export interface HoursInterval { day: number; open: string; close: string }
export interface HoursException {
  date: string;              // "YYYY-MM-DD", local date
  closed?: boolean;
  open?: string;
  close?: string;
  note?: string;
}
export interface SiteHours {
  weekly: HoursInterval[];   // multiple intervals per day allowed
  exceptions?: HoursException[];
  raw_text?: string;         // original text the hours were parsed from, for debugging
}

export interface Site {
  id: number;
  name: string;
  kind: SiteKind;
  tier: SiteTier;
  confidence: number | null;
  address: string;
  zip: string | null;
  lat: number;
  lon: number;
  hours: SiteHours;
  hours_confirmed_on_source: boolean;
  has_ac: boolean | null;
  has_filtration: boolean | null;
  capacity_est: number | null;
  phone: string | null;
  source_url: string;
  last_verified_at: string;  // ISO 8601
}

export interface CallerNeeds {
  has_car?: boolean;
  mobility_issues?: boolean;
  needs_clean_air?: boolean;   // smoke event rather than heat
  max_travel_minutes?: number;
}

export interface Reading {
  time: string;
  zip: string;
  temp_f: number | null;
  heat_index: number | null;
  aqi: number | null;
  source: 'airnow' | 'nws' | 'purpleair' | 'mock';
}

// ---- Tool contracts (see contracts.md) ----

export interface FindSitesInput {
  location: string;            // zip, neighborhood, address, or cross streets (free text)
  lat?: number;                // pass if already geocoded
  lon?: number;
  needs?: CallerNeeds;
  language?: Language;
  now?: string;                // ISO; override for demos/tests, default = current time
}

export interface SiteResult {
  site_id: number;
  name: string;
  kind: SiteKind;
  tier: SiteTier;
  address: string;
  open_now: boolean;
  closes_at: string | null;       // "HH:MM" local, today
  hours_today: string;            // human readable, e.g. "9:00 AM - 8:00 PM"
  travel_minutes: number;
  distance_miles: number;
  aqi: number | null;
  has_filtration: boolean | null;
  confidence: number | null;
  call_ahead: boolean;            // true for discovered sites
  map_url: string;
  spoken_summary: string;         // ready-to-read sentence honoring tier honesty rules
}

export interface FindSitesOutput {
  sites: SiteResult[];            // top 2, best first; may be empty
  resolved_zip: string | null;
  fallback_message?: string;      // set when sites is empty (e.g. "call 211")
}

export interface SendSmsInput {
  to: string;                     // E.164
  site_id: number;
  language?: Language;
}
export interface SendSmsOutput { ok: boolean; error?: string }
