// M4 (text / outbound) entry point. Nothing here is registered in src/mastra/index.ts yet: see ./README.md.

// Pieces for the Mastra instance.
export { textAgent } from './mastra/text-agent';
export { alertWorkflow } from './mastra/alert-workflow';
export { m4ApiRoutes } from './mastra/routes';
export { sendSmsTool } from './mastra/send-sms-tool';
export { findSitesTool } from './mastra/find-sites-tool';

// Shared contract. M3's voice agent calls sendSms, and must hash callers with hashPhone to match our rows.
export { sendSms } from './sms/send-sms';
export { hashPhone, toE164 } from './phone';

// Entry points behind the routes, for callers that are not HTTP.
export { handleInboundSms } from './subscribers/inbound';
export { subscribe, optOut } from './subscribers/consent';
export { triggerMockAlert } from './alerts/dispatch';
