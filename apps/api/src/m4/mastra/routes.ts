import { registerApiRoute, type ApiRoute } from '@mastra/core/server';
import { z } from 'zod';
import { triggerMockAlert } from '../alerts/dispatch';
import { env } from '../env';
import { validateTwilioSignature } from '../sms/twilio';
import { handleInboundSms } from '../subscribers/inbound';

// M4's HTTP surface. Custom routes mount at the server root, so the paths below are the full paths.
// They cannot start with the server's apiPrefix (default /api), which Mastra reserves for its built-in routes.

const TWILIO_SMS_PATH = '/m4/twilio/sms';
const MOCK_ALERT_PATH = '/m4/alerts/mock';

// The fields read from Twilio's form post. The signature check still covers every field Twilio sent.
const twilioSmsParams = z.object({
  From: z.string().min(1),
  Body: z.string().default(''),
  MessageSid: z.string().min(1),
});

const mockAlertBody = z.object({
  zips: z.array(z.string().regex(/^\d{5}$/)).min(1),
  headline: z.string().min(1).optional(),
});

function escapeXml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

// TwiML for the webhook response: one <Message> when there is a reply, an empty <Response/> otherwise.
function twiml(reply: string | null): string {
  const header = '<?xml version="1.0" encoding="UTF-8"?>';
  return reply
    ? `${header}<Response><Message>${escapeXml(reply)}</Message></Response>`
    : `${header}<Response/>`;
}

// Twilio inbound-message webhook. Twilio cannot log in, so Mastra auth is off and the signature is the gate.
const twilioSmsRoute = registerApiRoute(TWILIO_SMS_PATH, {
  method: 'POST',
  requiresAuth: false,
  handler: async (c) => {
    const form = await c.req.parseBody();
    const params: Record<string, string> = {};
    for (const [key, value] of Object.entries(form)) {
      if (typeof value === 'string') params[key] = value;
    }

    // Twilio signs the public URL it called, not the local one behind the tunnel.
    const url = env.publicBaseUrl().replace(/\/+$/, '') + TWILIO_SMS_PATH + new URL(c.req.url).search;
    const signature = c.req.header('x-twilio-signature');
    if (!signature || !validateTwilioSignature({ signature, url, params })) {
      c.get('mastra').getLogger()?.warn('Rejected Twilio SMS webhook: missing or invalid signature');
      return c.text('Forbidden', 403);
    }

    const parsed = twilioSmsParams.safeParse(params);
    if (!parsed.success) return c.text('Bad Request', 400);

    // TODO: Twilio gives up on a webhook after about 15 seconds (error 11200). If the agent reply can be slower than
    //       that, answer with an empty <Response/> right away and send the reply through the REST sender instead.
    // handleInboundSms does not throw: when something fails it returns a "try again, or call 211" reply instead,
    // because a 500 here would mean silence for the texter.
    const { reply } = await handleInboundSms({
      from: parsed.data.From,
      body: parsed.data.Body,
      messageSid: parsed.data.MessageSid,
    });
    return c.body(twiml(reply), 200, { 'Content-Type': 'text/xml; charset=utf-8' });
  },
});

// Demo trigger for M1's dashboard button: creates a kind = 'mock' alert and texts subscribers in the given zips.
// TODO: Protect this before the server gets a public URL: it can text every subscriber. requiresAuth is left at its
//       default (true), but that only takes effect once server.auth is configured on the Mastra instance. Until
//       then every route is public, so add a shared-secret header check here or configure auth.
const mockAlertRoute = registerApiRoute(MOCK_ALERT_PATH, {
  method: 'POST',
  handler: async (c) => {
    const parsed = mockAlertBody.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: 'Invalid body', issues: parsed.error.issues }, 400);

    const alert = await triggerMockAlert(parsed.data);
    return c.json({ alert }, 201);
  },
});

export const m4ApiRoutes: ApiRoute[] = [twilioSmsRoute, mockAlertRoute];
