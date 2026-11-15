// Read-only endpoint for the ops dashboard. Public on purpose: it carries no phone data (contracts.md).
import { registerApiRoute } from '@mastra/core/server';
import { db } from '../shared/db';
import { buildState, neonRaw, seedRaw } from './state';
import { siteDetail } from './site';

export const dashboardRoutes = [
  registerApiRoute('/dashboard/state', {
    method: 'GET',
    requiresAuth: false,
    handler: async (c) => {
      const q = c.req.query('now'); // ISO override for demos, like FindSitesInput.now
      const now = q ? new Date(q) : new Date();
      if (Number.isNaN(now.getTime())) return c.json({ error: 'now must be an ISO timestamp' }, 400);
      try {
        const state = db ? buildState(await neonRaw(db, now), now, 'neon') : buildState(seedRaw(), now, 'seed');
        return c.json(state);
      } catch (err) {
        console.error('[dashboard] state failed', err);
        return c.json({ error: 'database unavailable' }, 503);
      }
    },
  }),
  registerApiRoute('/dashboard/sites/:id', {
    method: 'GET',
    requiresAuth: false,
    handler: async (c) => {
      const id = Number(c.req.param('id'));
      if (!Number.isInteger(id)) return c.json({ error: 'id must be an integer' }, 400);
      try {
        const detail = await siteDetail(db, id);
        return detail ? c.json(detail) : c.json({ error: 'no such site' }, 404);
      } catch (err) {
        console.error('[dashboard] site detail failed', err);
        return c.json({ error: 'database unavailable' }, 503);
      }
    },
  }),
];
