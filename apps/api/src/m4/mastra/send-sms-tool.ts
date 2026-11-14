import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { sendSms } from '../sms/send-sms';
import { LANGUAGES } from '../types';
import type { SendSmsInput, SendSmsOutput } from '../types';

// Mirrors SendSmsInput and SendSmsOutput from the shared contract. The `satisfies` checks catch drift.
const sendSmsInputSchema = z.object({
  to: z.string().describe('Recipient phone number in E.164 format, for example +16195550123.'),
  site_id: z.number().int().describe('Id of the site to text, taken from a find_sites result.'),
  language: z.enum(LANGUAGES).optional().describe('Language of the text. Defaults to English.'),
}) satisfies z.ZodType<SendSmsInput>;

const sendSmsOutputSchema = z.object({
  ok: z.boolean(),
  error: z.string().optional().describe('Why the text was not sent, when ok is false.'),
}) satisfies z.ZodType<SendSmsOutput>;

// Mastra wrapper around the shared send_sms contract, for agents in this app.
// TODO: register it on the agent that uses it (and in src/mastra/index.ts if it should be callable on its own).
// TODO: the model supplies `to`. Bind it to the conversation's own number before the text agent gets this
//       tool, and mask it with createTool's `transform` option so the raw number is not kept in transcripts.
export const sendSmsTool = createTool({
  id: 'send_sms',
  description:
    'Text one site to a phone number: address, hours today, map link and air quality. Refuses numbers that have opted out.',
  inputSchema: sendSmsInputSchema,
  outputSchema: sendSmsOutputSchema,
  // The text is already sent by the time the result is validated, so a schema mismatch must not trigger a retry.
  outputValidation: 'warn',
  execute: async (input) => sendSms(input),
});
