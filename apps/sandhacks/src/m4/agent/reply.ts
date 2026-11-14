import { notImplemented } from '../todo';
import type { CallOutcome, Language } from '../types';

export interface TextReply {
  text: string;
  outcome: CallOutcome | null; // null when the turn neither gave a site nor escalated, e.g. a clarifying question
  siteId: number | null;
  language: Language;
}

// One turn of the SMS conversation: load history by phone hash, run the agent, store both messages.
// It writes only to messages. STOP/START/HELP handling, sending the reply and the calls row belong to the caller.
export async function generateTextReply(args: { phoneE164: string; body: string }): Promise<TextReply> {
  // TODO: 1. phoneHash = hashPhone(args.phoneE164) from '../phone'. Use maskPhone for log lines. Keep the raw
  //          number out of everything handed to the agent (messages, system note, tracingOptions.metadata):
  //          the observability config in src/mastra/index.ts exports agent runs.
  // TODO: 2. Emergency pre-check, before any model call: if looksLikeEmergency(args.body) from './safety',
  //          pick the language (getSubscriber(phoneHash) from '../db', else 'en'), store the user message and
  //          emergencyReply(language) with insertMessage, and return
  //          { text: emergencyReply(language), outcome: 'escalated_911', siteId: null, language }.
  // TODO: 3. history = await listRecentMessages(phoneHash) from '../db' (oldest first, default limit 20).
  //          The alert text that started the conversation has to be in messages too, or "something closer?"
  //          arrives with no context.
  // TODO: 4. Run the agent with the history passed in explicitly. textAgent from '../mastra/text-agent' has no
  //          Mastra memory, so do not pass the `memory` option:
  //            const response = await textAgent.generate(
  //              [...history.map((m) => ({ role: m.role, content: m.body })), { role: 'user', content: args.body }],
  //              { system: <short note with the subscriber's zip, language and needs>, maxSteps: 4,
  //                modelSettings: { maxOutputTokens: <SMS-sized cap> } },
  //            );
  //          Catch a thrown error, and check response.finishReason === 'error', response.error and an empty
  //          response.text: in each case reply with a fixed fallback that gives 211, with outcome 'error'.
  // TODO: 5. Store both turns, user first: insertMessage({ phoneHash, role: 'user', body: args.body }), then
  //          insertMessage({ phoneHash, role: 'assistant', body: response.text }).
  // TODO: 6. Derive outcome and siteId from the tool results. Walk response.steps[].toolResults; each entry is
  //          { type: 'tool-result', payload: { toolName, result, isError } }. Keep the ones where
  //          payload.toolName === 'find_sites' and use the last. payload.isError -> 'error'. Otherwise result is
  //          a FindSitesOutput: sites[0] present -> 'site_given' with siteId = sites[0].site_id; sites empty ->
  //          'no_site_found'. No find_sites call in this turn -> outcome null, siteId null.
  // TODO: 7. Set `language` to the language of the reply. Undecided: read it from the find_sites call args
  //          (response.steps[].toolCalls[].payload.args.language) with the subscriber's language as fallback,
  //          or ask the model for it with the `structuredOutput` option.
  // TODO: 8. Decide whether the AI disclosure on a first reply is enforced here instead of left to the prompt.
  return notImplemented('reply.generateTextReply');
}
