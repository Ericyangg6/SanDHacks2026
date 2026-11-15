// GET /m2/changes: the "what changed" feed written by ingest/daily-recrawl.ts. Reads Neon `site_changes`; falls back to
// data/seed/changes_feed.json when the database is unreachable. Public data (page diffs of public pages), read-only.
import { registerApiRoute } from '@mastra/core/server';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const DB_URL = (process.env.SITES_DATABASE_URL ?? process.env.NEON_DATABASE_URL ?? '').replace(/^"|"$/g, '');

async function fromNeon(limit: number): Promise<unknown[] | null> {
  if (!DB_URL) return null;
  try {
    const res = await fetch(`https://${new URL(DB_URL).hostname}/sql`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Neon-Connection-String': DB_URL },
      body: JSON.stringify({ query: 'select id, detected_at, kind, url, site_ids, site_names, summary, before, after from site_changes order by detected_at desc limit $1', params: [limit] }),
      signal: AbortSignal.timeout(3000),
    });
    return res.ok ? (((await res.json()) as { rows?: unknown[] }).rows ?? null) : null;
  } catch { return null; }
}

async function fromFile(limit: number): Promise<unknown[]> {
  for (const d of [process.env.SITES_SEED_DIR, resolve(process.cwd(), 'data/seed'), resolve(process.cwd(), '../../data/seed')]) {
    if (!d) continue;
    try { return (JSON.parse(await readFile(resolve(d, 'changes_feed.json'), 'utf8')).entries as unknown[]).slice(0, limit); } catch { /* next */ }
  }
  return [];
}

export const changesFeedRoute = registerApiRoute('/m2/changes', {
  method: 'GET',
  requiresAuth: false,
  handler: async (c) => {
    const limit = Math.min(200, Math.max(1, Number(c.req.query('limit') ?? 50) || 50));
    const rows = (await fromNeon(limit)) ?? (await fromFile(limit));
    return c.json({ changes: rows, count: rows.length });
  },
});
