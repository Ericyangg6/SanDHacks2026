import {
  addTextsSent,
  DbError,
  getAlertByNwsId,
  hasAlertText,
  hasRecentAlertText,
  insertAlert,
  insertMessage,
  listActiveSubscribersByZips,
} from '../db';
import { findSites } from '../find-sites';
import { maskPhone } from '../phone';
import { sendText } from '../sms/send-sms';
import { alertMessage } from '../sms/templates';
import type { AlertRow, SiteResult, SubscriberContact } from '../types';
import { toAlertKind, type NwsAlert } from './nws';
import { zipsForZones } from './zones';

// Inserts the alert unless one with the same nws_id exists. An alert that names no San Diego zip is still
// recorded, so the dashboard shows it; dispatching it texts nobody.
export async function recordAlert(alert: NwsAlert): Promise<{ alert: AlertRow; isNew: boolean }> {
  const existing = await getAlertByNwsId(alert.id);
  if (existing) return { alert: existing, isNew: false };

  const kind = toAlertKind(alert.event);
  if (!kind) throw new Error(`recordAlert: unhandled NWS event "${alert.event}"`);
  try {
    const row = await insertAlert({
      kind,
      nwsId: alert.id,
      zips: zipsForZones(alert.zones),
      headline: alert.headline,
      onsetAt: alert.onset ? new Date(alert.onset) : null,
      expiresAt: alert.expires ? new Date(alert.expires) : null,
    });
    return { alert: row, isNew: true };
  } catch (error) {
    // Two overlapping polls can both get past the check above. nws_id is unique, so the loser lands here.
    if (error instanceof DbError && error.code === '23505') {
      const winner = await getAlertByNwsId(alert.id);
      if (winner) return { alert: winner, isNew: false };
    }
    throw error;
  }
}

// NWS gives every update to an alert a new id, so a heat wave that is extended twice a day arrives as several
// "new" alerts. A subscriber gets at most one text per alert kind inside this window.
export const ALERT_TEXT_COOLDOWN_HOURS = 12;

function reason(error: unknown): string {
  return error instanceof Error ? error.message : 'unknown error';
}

// True when this subscriber should get a text for this alert. Mock alerts skip the cooldown so the demo button
// works every time it is pressed. The per-alert guard always applies, which makes a re-run after a crash safe.
async function shouldText(subscriber: SubscriberContact, alert: AlertRow, since: Date): Promise<boolean> {
  if (await hasAlertText(subscriber.phone_hash, alert.id)) return false;
  // Per kind, so a Heat Advisory upgraded to an Extreme Heat Warning still gets its own text.
  if (alert.kind !== 'mock' && (await hasRecentAlertText(subscriber.phone_hash, alert.kind, since))) return false;
  return true;
}

// The nearest open site for this subscriber, or null. M2 owns the ranking: the result is never re-sorted here.
async function nearestSite(subscriber: SubscriberContact, alert: AlertRow): Promise<SiteResult | null> {
  const needs = alert.kind === 'air_quality_alert' ? { ...subscriber.needs, needs_clean_air: true } : subscriber.needs;
  const { sites } = await findSites({ location: subscriber.zip, needs, language: subscriber.language });
  return sites[0] ?? null;
}

// Texts every active subscriber in alert.zips their nearest open site: once per alert, and at most once per
// alert kind every ALERT_TEXT_COOLDOWN_HOURS. One subscriber's failure never stops the others.
export async function dispatchAlert(alert: AlertRow): Promise<{ textsSent: number }> {
  const subscribers = await listActiveSubscribersByZips(alert.zips);
  const since = new Date(Date.now() - ALERT_TEXT_COOLDOWN_HOURS * 3600_000);
  let textsSent = 0;

  // One at a time, so a big list is not fired at Twilio all at once.
  // TODO: pace the sends to the sending number's rate limit once Twilio is set up (M4.md: rate limits).
  for (const subscriber of subscribers) {
    const who = maskPhone(subscriber.phone_e164);
    try {
      if (!(await shouldText(subscriber, alert, since))) continue;
    } catch (error) {
      // Not knowing whether they were texted already, skip them rather than risk a repeat.
      console.warn(`[m4] alert ${alert.id}: skipped ${who}, the repeat check failed (${reason(error)})`);
      continue;
    }

    // A failed lookup still sends the alert, with the "call 211" version instead of a site.
    const site = await nearestSite(subscriber, alert).catch((error) => {
      console.warn(`[m4] alert ${alert.id}: find_sites failed for ${who} (${reason(error)})`);
      return null;
    });

    const body = alertMessage({ alert, site, language: subscriber.language });
    // sendText writes the calls row with alert_id, which is the row both guards read.
    const result = await sendText({
      to: subscriber.phone_e164,
      body,
      purpose: 'alert',
      alertId: alert.id,
      siteId: site?.site_id,
      zip: subscriber.zip,
      language: subscriber.language,
    });
    if (!result.ok) {
      console.warn(`[m4] alert ${alert.id}: not sent to ${who} (${result.error})`);
      continue;
    }
    textsSent++;

    // The text agent reads its history from messages, so a reply like "something closer?" needs this.
    await insertMessage({ phoneHash: subscriber.phone_hash, role: 'assistant', body }).catch((error) =>
      console.warn(`[m4] alert ${alert.id}: alert text for ${who} not saved to messages (${reason(error)})`),
    );
  }

  if (textsSent > 0) await addTextsSent(alert.id, textsSent);
  return { textsSent };
}

// Demo path: inserts a kind = 'mock' alert with a null nws_id, then dispatches it.
// It skips the re-crawl the real flow asks M2 for: the button should answer in seconds.
// Throws on bad zips. Pressing it twice makes two alerts, and each texts everyone in the zips.
export async function triggerMockAlert(args: { zips: string[]; headline?: string }): Promise<AlertRow> {
  if (args.zips.length === 0 || !args.zips.every((zip) => /^\d{5}$/.test(zip))) {
    throw new Error('triggerMockAlert: zips must be a non-empty list of 5-digit zip codes');
  }
  const row = await insertAlert({
    kind: 'mock',
    nwsId: null,
    zips: [...new Set(args.zips)],
    headline: args.headline ?? 'Test alert from the Shade demo button. Not a real warning.',
    onsetAt: new Date(),
    expiresAt: null,
  });
  const { textsSent } = await dispatchAlert(row);
  // The inserted row still says 0.
  return { ...row, texts_sent: row.texts_sent + textsSent };
}
