import { notImplemented } from '../todo';

export interface InboundSms {
  from: string; // as Twilio sends it; normalize with toE164 before use
  body: string;
  messageSid: string;
}

// Routes one inbound text: STOP / START / HELP / JOIN <zip> are handled here, anything else goes to the text agent.
// Returns the reply to send back (null = send nothing) and logs the inbound sms row in calls.
export async function handleInboundSms(msg: InboundSms): Promise<{ reply: string | null }> {
  // TODO: 1. phoneE164 = toE164(msg.from). If null (short code, alphanumeric sender), return { reply: null }.
  //          Log lines use maskPhone, never the raw number.
  // TODO: 2. phoneHash = hashPhone(phoneE164); subscriber = await getSubscriber(phoneHash).
  //          Reply language: the subscriber's, else 'es' when the keyword was a Spanish one, else 'en'.
  //          detectKeyword does not say which language matched, so that needs a second check.
  // TODO: 3. Branch on detectKeyword(msg.body):
  //          - 'stop':  optOut(phoneE164). Twilio answers STOP itself by default and then blocks our sends to that
  //                     number (error 21610), so decide between reply: null and optOutConfirmation(language).
  //          - 'start': with a subscriber row, subscribe() again with its zip and language (clears opted_out_at) and
  //                     reply optInConfirmation(language). Without one there is no zip, so ask for JOIN <zip>.
  //          - 'help':  reply helpMessage(language). Twilio may also answer HELP itself; avoid a double reply.
  //          - 'join':  zip = first /\b\d{5}\b/ in the body. No zip: reply with the JOIN <zip> usage line.
  //                     Otherwise subscribe({ phoneE164, zip, language }) and reply optInConfirmation(language).
  //          - null:    if the subscriber is opted out, return { reply: null }. Otherwise
  //                     generateTextReply({ phoneE164, body: msg.body }) and use its text, outcome, siteId and language.
  //                     The agent slice writes the messages rows; keyword exchanges are not stored there.
  // TODO: 4. insertCall({ direction: 'inbound', channel: 'sms', phoneHash, zip: subscriber?.zip, language, siteId, outcome }).
  //          call_outcome has no value for keyword messages, so outcome is null for those. Use 'error' when the agent throws.
  // TODO: 5. Twilio can deliver the same MessageSid twice. Nothing in the schema stores it, so pick a dedupe strategy.
  return notImplemented('inbound.handleInboundSms');
}
