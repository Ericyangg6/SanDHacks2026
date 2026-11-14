// Sends one text to TEST_PHONE_NUMBER straight through the Twilio client, with no database involved:
//   node src/m4/dev/run.mjs send-test ["message"]
// With M4_SMS_DRY_RUN=1 nothing is sent and the text is logged instead.

import { env, requireEnv } from '../env';
import { maskPhone, toE164 } from '../phone';
import { sendTwilioSms, TwilioError } from '../sms/twilio';

const to = toE164(requireEnv('TEST_PHONE_NUMBER'));
if (!to) throw new Error('TEST_PHONE_NUMBER is not a valid phone number');

const body = process.argv[3] ?? 'Shade test message. No action needed.';

try {
  const { sid } = await sendTwilioSms({ to, body });
  console.log(env.smsDryRun() ? `Dry run finished (${sid}).` : `Twilio accepted the text for ${maskPhone(to)}: ${sid}`);
} catch (error) {
  if (!(error instanceof TwilioError)) throw error;
  console.error(`Not sent: ${error.message} (HTTP ${error.status ?? 'none'}, Twilio code ${error.code ?? 'none'})`);
  process.exitCode = 1;
}
