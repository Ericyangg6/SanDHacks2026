// Dispatcher inbox. Unauthenticated: it carries what callers said and where they are, but never the callback number.
import { registerApiRoute } from '@mastra/core/server';
import { listOpenRequests } from './requests';

export const requestRoutes = [
  registerApiRoute('/dispatch/requests', {
    method: 'GET',
    requiresAuth: false,
    handler: async (c) => {
      try {
        return c.json({ requests: await listOpenRequests() });
      } catch (err) {
        console.error('[requests] list failed', err);
        return c.json({ error: 'database unavailable' }, 503);
      }
    },
  }),
];
