import {
  addTextsSent,
  getAlertByNwsId,
  hasAlertText,
  hasRecentAlertText,
  insertAlert,
  listActiveSubscribersByZips,
} from '../db';
import { findSites } from '../find-sites';
import { maskPhone } from '../phone';
import { sendText } from '../sms/send-sms';
import { alertMessage } from '../sms/templates';
import { notImplemented } from '../todo';
import type { AlertRow } from '../types';
import { toAlertKind, type NwsAlert } from './nws';
import { zipsForZones } from './zones';

// The imports above are the pieces the TODO steps below call; they are unused until the bodies are written.

// Inserts the alert unless one with the same nws_id exists.
export async function recordAlert(alert: NwsAlert): Promise<{ alert: AlertRow; isNew: boolean }> {
  // TODO: 1. existing = await getAlertByNwsId(alert.id). If found, return { alert: existing, isNew: false }.
  // TODO: 2. kind = toAlertKind(alert.event). Throw if null: fetchActiveAlerts should have filtered it out.
  // TODO: 3. zips = zipsForZones(alert.zones). Decide whether an alert that maps to no zips is still recorded.
  // TODO: 4. row = await insertAlert({ kind, nwsId: alert.id, zips, headline: alert.headline,
  //          onsetAt and expiresAt as Date or null from alert.onset and alert.expires }).
  // TODO: 5. Two overlapping polls can both pass step 1. alerts.nws_id is unique, so treat a unique violation as
  //          "already recorded": re-read and return isNew: false.
  // TODO: 6. Return { alert: row, isNew: true }.
  return notImplemented('dispatch.recordAlert');
}

// NWS gives every update to an alert a new id, so a heat wave that is extended twice a day arrives as several
// "new" alerts. A subscriber gets at most one text per alert kind inside this window.
export const ALERT_TEXT_COOLDOWN_HOURS = 12;

// Texts every active subscriber in alert.zips their nearest open site: once per alert, and at most once per
// alert kind every ALERT_TEXT_COOLDOWN_HOURS.
export async function dispatchAlert(alert: AlertRow): Promise<{ textsSent: number }> {
  // TODO: 1. subscribers = await listActiveSubscribersByZips(alert.zips).
  // TODO: 2. For each subscriber, skip when await hasAlertText(subscriber.phone_hash, alert.id). This is the
  //          "no repeat texts for the same alert" guard, and it makes a re-run after a crash safe.
  // TODO: 3. Unless alert.kind === 'mock', also skip when await hasRecentAlertText(subscriber.phone_hash,
  //          alert.kind, since), with since = now minus ALERT_TEXT_COOLDOWN_HOURS. The check is per kind so that a
  //          Heat Advisory upgraded to an Extreme Heat Warning still gets its own text. Mock alerts skip it so
  //          the demo button works every time it is pressed.
  // TODO: 4. { sites } = await findSites({ location: subscriber.zip, needs: subscriber.needs,
  //          language: subscriber.language }); site = sites[0] ?? null. For kind 'air_quality_alert' pass
  //          needs_clean_air: true. M2 owns the ranking: never re-sort or filter the result here.
  // TODO: 5. body = alertMessage({ alert, site, language: subscriber.language }).
  // TODO: 6. result = await sendText({ to: subscriber.phone_e164, body, purpose: 'alert', alertId: alert.id,
  //          siteId: site?.site_id, zip: subscriber.zip, language: subscriber.language }).
  //          sendText writes the calls row with alert_id, which is the row both guards read. Do not insertCall
  //          here as well. If failed sends ever get a calls row too, the guards must count only 'sms_sent'.
  // TODO: 7. Count result.ok. One failed send must not stop the loop. Log failures with maskPhone only, never the
  //          raw number.
  // TODO: 8. Pace the sends to stay under Twilio's rate limit (M4.md: rate limits).
  // TODO: 9. await addTextsSent(alert.id, textsSent) once at the end, then return { textsSent }.
  return notImplemented('dispatch.dispatchAlert');
}

// Demo path: inserts a kind = 'mock' alert with a null nws_id, then dispatches it.
export async function triggerMockAlert(args: { zips: string[]; headline?: string }): Promise<AlertRow> {
  // TODO: 1. Reject an empty zips list and anything that is not a 5-digit string.
  // TODO: 2. row = await insertAlert({ kind: 'mock', nwsId: null, zips: args.zips,
  //          headline: args.headline ?? <a default that says it is a test>, onsetAt: new Date(), expiresAt: null }).
  // TODO: 3. Decide whether the demo path also calls requestRecrawl(args.zips) first. The real flow does.
  // TODO: 4. { textsSent } = await dispatchAlert(row).
  // TODO: 5. Return { ...row, texts_sent: textsSent }: the inserted row still says 0.
  return notImplemented('dispatch.triggerMockAlert');
}
