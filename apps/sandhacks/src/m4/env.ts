// Read lazily so the Mastra app still boots when an M4 key is missing; the error surfaces on first use.

export function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing environment variable ${name}`);
  return value;
}

export const env = {
  // TWILIO_SID and TWILIO_SECRET are an API key pair (the SID starts with SK). They authenticate REST calls,
  // but the request URL still takes the account SID (starts with AC).
  twilio: () => ({
    accountSid: requireEnv('TWILIO_ACCOUNT_SID'),
    apiKeySid: requireEnv('TWILIO_SID'),
    apiKeySecret: requireEnv('TWILIO_SECRET'),
    phoneNumber: requireEnv('TWILIO_PHONE_NUMBER'),
  }),
  // Twilio signs webhooks with the account's auth token, not with the API key secret.
  twilioAuthToken: () => requireEnv('TWILIO_AUTH_TOKEN'),
  phoneSalt: () => requireEnv('PHONE_SALT'),
  databaseUrl: () => requireEnv('NEON_DATABASE_URL'),
  nwsUserAgent: () => requireEnv('NWS_USER_AGENT'),
  // Public origin Twilio calls, e.g. the tunnel URL. Needed to validate webhook signatures.
  publicBaseUrl: () => requireEnv('PUBLIC_BASE_URL'),
  textAgentModel: () => process.env.TEXT_AGENT_MODEL || 'anthropic/claude-sonnet-5-5',
};
