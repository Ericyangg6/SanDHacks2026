import { toE164 } from '../phone';

// What a Messenger JOIN carries: JOIN <zip> [phone], in either order after the keyword.
//   JOIN 92105                  zip only
//   JOIN 92105 14156889097      zip and the phone number to link
//   JOIN 92105 (415) 688-9097
// Any other words are ignored. The person's name is not typed: it comes from their Facebook profile
// (./profile.ts).
export interface JoinRequest {
  zip: string | null; // the first 5-digit word, or null
  phoneE164: string | null; // the phone number given, normalized, or null when none was given
  phoneInvalid: boolean; // digits were given that are not a phone number
}

// Pure. The first word is the keyword (JOIN, UNIRME, SUBSCRIBE ...) and is skipped. A 5-digit word is the zip;
// every other word made only of digits and + ( ) . - is part of the phone number.
export function parseJoinMessage(body: string): JoinRequest {
  const words = body.trim().split(/\s+/).slice(1);
  const zipIndex = words.findIndex((word) => /^\d{5}$/.test(word));
  const zip = zipIndex >= 0 ? words[zipIndex] : null;
  const rest = words.filter((_, index) => index !== zipIndex);

  const phoneParts = rest.filter((word) => /\d/.test(word) && /^[+()\d.-]+$/.test(word));
  const phoneE164 = phoneParts.length > 0 ? toE164(phoneParts.join('')) : null;

  return { zip, phoneE164, phoneInvalid: phoneParts.length > 0 && !phoneE164 };
}
