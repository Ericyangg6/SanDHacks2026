// Stands in for a voice call ending: does what elevenlabs/post-call.ts does for M4 after a real call, without
// ElevenLabs. Finds the nearest open site for a zip (M2's find_sites, as the voice agent would) and calls
// followUpAfterCall, which holds that site for the caller's linked Messenger profile.
//   node src/m4/dev/run.mjs call-ended --phone +14155550100 [--zip 92105] [--site <id>] [--lang en]
// The phone must be the number linked on Messenger with JOIN <zip> <phone>. Then send the Shadoes Page any message:
// the site arrives first, then the reply. Writes a real messenger_followups row; nothing is sent by this script.

import { findSites } from '../find-sites';
import { followUpAfterCall } from '../sms/send-sms';
import { maskPhone, toE164 } from '../phone';

const args = process.argv.slice(3);
function option(name: string): string | undefined {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
}

const phone = toE164(option('--phone') ?? '');
if (!phone) throw new Error('--phone is required: the number you linked on Messenger, e.g. --phone +14155550100');
const zip = option('--zip') ?? '92105';
const language = option('--lang') ?? 'en';

let siteId = Number(option('--site'));
let siteName = `site ${siteId}`;
if (!Number.isInteger(siteId) || siteId <= 0) {
  const { sites } = await findSites({ location: zip, needs: {}, language: language as 'en' });
  if (!sites[0]) throw new Error(`find_sites found no open site for ${zip}; pass --site <id>`);
  siteId = sites[0].site_id;
  siteName = sites[0].name;
}

const result = await followUpAfterCall({ phoneE164: phone, siteId, language });
console.log(`Call from ${maskPhone(phone)} ended with ${siteName} (id ${siteId}): ${result}`);
const next: Record<string, string> = {
  queued: 'Now send the Shadoes Page any message on Messenger: the site arrives first, then the reply.',
  already_queued: 'That site was already held for this person in the last 2 hours. Message the Page to receive it.',
  no_profile: 'No Messenger profile is linked to this number. Send JOIN <zip> <this number> to the Page first.',
  opted_out: 'This number opted out (STOP). Send START or JOIN to the Page first.',
  no_site: 'No such site.',
  failed: 'Something failed; see the error above.',
};
console.log(next[result]);
