// Dispatcher inbox. Unauthenticated: it carries what callers said and where they are, but never the callback number.
// `calls` are calls Shade is on now that have not asked for help; each row carries its step-by-step trail.
import { registerApiRoute } from '@mastra/core/server';
import { listLiveCalls } from './events';
import { listOpenRequests } from './requests';

export const requestRoutes = [
  registerApiRoute('/dispatch/requests', {
    method: 'GET',
    requiresAuth: false,
    handler: async (c) => {
      try {
        const [requests, calls] = await Promise.all([listOpenRequests(), listLiveCalls()]);
        return c.json({ requests, calls });
      } catch (err) {
        console.error('[requests] list failed', err);
        return c.json({ error: 'database unavailable' }, 503);
      }
    },
  }),
];
