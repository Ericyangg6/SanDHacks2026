// Read lazily so the Mastra app still boots when an M4 key is missing; the error surfaces on first use.

export function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing environment variable ${name}`);
  return value;
}

// REST calls authenticate with an API key pair when TWILIO_SID and TWILIO_SECRET are set (the SID starts with
// SK), and otherwise with the account SID and auth token, the two the team's .env.template has.
// The request URL takes the account SID (starts with AC) either way.
function twilioCredentials() {
  const accountSid = requireEnv('TWILIO_ACCOUNT_SID');
  const useApiKey = Boolean(process.env.TWILIO_SID && process.env.TWILIO_SECRET);
  return {
    accountSid,
    username: useApiKey ? requireEnv('TWILIO_SID') : accountSid,
    password: useApiKey ? requireEnv('TWILIO_SECRET') : requireEnv('TWILIO_AUTH_TOKEN'),
  };
}

export const env = {
  twilioCredentials,
  // SMS sends also need the sending number. Messenger sends do not: they go from the Page that was written to.
  twilio: () => ({ ...twilioCredentials(), phoneNumber: requireEnv('TWILIO_PHONE_NUMBER') }),
  // The WhatsApp sender's number, E.164. Defaults to TWILIO_PHONE_NUMBER, the number the sender is registered on.
  whatsAppFrom: () => process.env.TWILIO_WHATSAPP_FROM || requireEnv('TWILIO_PHONE_NUMBER'),
  // Content SID (HX...) of the approved WhatsApp alert template, or null while there is none. Without it,
  // WhatsApp subscribers only get alerts within 24 hours of their last message. Spanish subscribers get the
  // _ES template when it is set, else the default one.
  whatsAppAlertContentSid: (language: string) =>
    (language === 'es' && process.env.TWILIO_WHATSAPP_ALERT_CONTENT_SID_ES) ||
    process.env.TWILIO_WHATSAPP_ALERT_CONTENT_SID ||
    null,
  // Twilio signs webhooks with the account's auth token, not with the API key secret.
  twilioAuthToken: () => requireEnv('TWILIO_AUTH_TOKEN'),
  phoneSalt: () => requireEnv('PHONE_SALT'),
  databaseUrl: () => requireEnv('NEON_DATABASE_URL'),
  nwsUserAgent: () => requireEnv('NWS_USER_AGENT'),
  // Public origin Twilio calls, e.g. the tunnel URL. Needed to validate webhook signatures.
  publicBaseUrl: () => requireEnv('PUBLIC_BASE_URL'),
  textAgentModel: () => process.env.TEXT_AGENT_MODEL || 'anthropic/claude-sonnet-5-5',
  // M4_SMS_DRY_RUN=1: every text is written to the server log instead of going to Twilio. Everything else runs
  // as normal, including the calls rows, so delete those after a dry run against the shared database.
  smsDryRun: () => isOn(process.env.M4_SMS_DRY_RUN),
};

function isOn(value: string | undefined): boolean {
  return value === '1' || value === 'true';
}
