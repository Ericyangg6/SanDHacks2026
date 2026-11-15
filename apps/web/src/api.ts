// Reads the Shade API (apps/api). Types come from the API itself so a contract change fails `tsc` here.
import { useEffect, useState } from 'react';
import type { DashboardState } from '../../api/src/dashboard/state';
import type { CallEvent, HelpRequest, SiteHours } from '../../../data/schema/types';

export type { DashboardState, HelpRequest, CallEvent };
export type Zone = DashboardState['sites'][number];
export type ReadingRow = DashboardState['readings'][number];
export interface LiveCall { id: number; started_at: string; events: CallEvent[] }   // apps/api/src/requests/events.ts
export interface Inbox { requests: HelpRequest[]; calls: LiveCall[] }
/** GET /dashboard/sites/:id (apps/api/src/dashboard/site.ts). */
export interface SiteDetail {
  phone: string | null; category: string | null; access_notes: string | null; pet_policy: string | null;
  source_url: string | null; maps_url: string | null; hours: SiteHours;
  google: { rating: number | null; ratings: number | null; maps_url: string | null; website: string | null; status: string | null; summary: string | null; photo: string | null } | null;
}

const qs = new URLSearchParams(location.search);
export const API = qs.get('api') || 'http://localhost:4111';   // ?api=https://xxxx.ngrok-free.app
const NOW = qs.get('now');                                     // ?now=2026-11-16T11:00:00-08:00 replays a moment for demos

export async function get<T>(path: string): Promise<T> {
  const res = await fetch(`${API}${path}`, { cache: 'no-store' });
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || `HTTP ${res.status}`);
  return res.json();
}

export const statePath = `/dashboard/state${NOW ? `?now=${encodeURIComponent(NOW)}` : ''}`;

/** Polls `path` every `ms`. Keeps the last good data through errors; only swaps it when the content changed. */
export function usePoll<T>(path: string, ms = 10000) {
  const [s, set] = useState<{ data: T | null; error: string | null; key: string }>({ data: null, error: null, key: '' });
  useEffect(() => {
    const tick = async () => {
      try {
        const data = await get<T>(path);
        // generated_at moves every poll; ignoring it keeps the map and lists from redrawing for nothing.
        const key = JSON.stringify(data, (k, v) => (k === 'generated_at' ? undefined : v));
        set((p) => (p.key === key ? (p.error ? { ...p, error: null } : p) : { data, error: null, key }));
      } catch (err) {
        set((p) => ({ ...p, error: (err as Error).message }));
      }
    };
    tick();
    const t = setInterval(tick, ms);
    return () => clearInterval(t);
  }, [path, ms]);
  return s;
}
