// One site's detail for the dashboard's left panel: what ingest already knows, plus a live Google Places lookup.
// Google has no busyness field in any official API; crowding here comes from review mentions (site_review_signals).
import type { Site } from '../../../../data/schema/types';
import sitesSeed from '../../../../data/seed/sites.json';
import extrasSeed from '../../../../data/seed/sites.extras.json';

interface Queryable { query(sql: string, params?: unknown[]): Promise<{ rows: any[] }> }
interface Quote { signal: string; quote: string }

export async function siteRow(db: Queryable | null, id: number) {
  if (db) {
    const { rows } = await db.query(
      `select s.phone, s.has_ac, s.category, s.access_notes, s.pet_policy, s.maps_place_id, s.source_url, s.hours,
              g.reviews_scanned, g.crowded, g.spacious, g.quotes
       from sites s left join site_review_signals g on g.site_id = s.id where s.id = $1`, [id]);
    return rows[0] ?? null;
  }
  const s = (sitesSeed as Site[]).find((x) => x.id === id);
  if (!s) return null;
  const x = (extrasSeed as Record<string, any>)[id] ?? {}, g = x.review_signals;
  return {
    phone: s.phone, has_ac: s.has_ac, category: x.category ?? null, access_notes: x.access_notes ?? null,
    pet_policy: x.pet_policy ?? null, maps_place_id: x.maps_place_id ?? null, source_url: s.source_url, hours: s.hours,
    reviews_scanned: g?.scanned ?? null, crowded: g?.crowded ?? null, spacious: g?.spacious ?? null, quotes: g?.quotes ?? [],
  };
}

// Places API (New) details. Needs "Places API (New)" enabled on GOOGLE_MAPS_API_KEY; null without a key or on any error.
const FIELDS = 'rating,userRatingCount,googleMapsUri,websiteUri,businessStatus,currentOpeningHours.openNow,editorialSummary.text,photos.name';
const cache = new Map<string, { at: number; v: unknown }>(); // 10 min, so clicking around doesn't re-bill
export async function googlePlace(placeId: string | null) {
  const key = process.env.GOOGLE_MAPS_API_KEY?.trim();
  if (!key || !placeId) return null;
  const hit = cache.get(placeId);
  if (hit && Date.now() - hit.at < 6e5) return hit.v;
  try {
    const get = async (path: string) => {
      const r = await fetch(`https://places.googleapis.com/v1/${path}`, { headers: { 'X-Goog-Api-Key': key, 'X-Goog-FieldMask': FIELDS }, signal: AbortSignal.timeout(4000) });
      if (!r.ok) throw new Error(`${r.status} ${(await r.text()).slice(0, 200)}`);
      return r.json();
    };
    const p = await get(`places/${encodeURIComponent(placeId)}`);
    // Resolve the photo server-side so the key never reaches the browser.
    const photo = p.photos?.[0]?.name ? (await get(`${p.photos[0].name}/media?maxWidthPx=720&skipHttpRedirect=true`).catch(() => null))?.photoUri ?? null : null;
    const v = {
      rating: p.rating ?? null, ratings: p.userRatingCount ?? null, maps_url: p.googleMapsUri ?? null, website: p.websiteUri ?? null,
      status: p.businessStatus ?? null, open_now: p.currentOpeningHours?.openNow ?? null, summary: p.editorialSummary?.text ?? null, photo,
    };
    cache.set(placeId, { at: Date.now(), v });
    return v;
  } catch (err) {
    console.error('[dashboard] google place failed', (err as Error).message);
    return null;
  }
}

export async function siteDetail(db: Queryable | null, id: number) {
  const r = await siteRow(db, id);
  if (!r) return null;
  const { maps_place_id, quotes, ...rest } = r;
  return {
    ...rest,
    crowd_quote: (quotes as Quote[] | null)?.find((q) => q.signal === 'crowded')?.quote ?? null,
    // Works without a key: opens the exact place in Google Maps.
    maps_url: maps_place_id ? `https://www.google.com/maps/place/?q=place_id:${maps_place_id}` : null,
    google: await googlePlace(maps_place_id),
  };
}
