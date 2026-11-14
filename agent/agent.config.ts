// Source of truth for the Shade voice agent. Pushed to ElevenLabs by scripts/sync-agent.ts.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const read = (p: string) => readFileSync(join(here, p), 'utf8').trim();

export const AGENT_NAME = 'Shade';

// Gemini runs inside ElevenLabs (no Gemini key needed on our side).
export const LLM = 'gemini-2.5-flash';

// Low-latency TTS. ElevenLabs requires English agents to use an English-only v2 model;
// other languages get the multilingual v2.5 model through their language preset below.
export const TTS_MODEL = 'eleven_flash_v2';
export const TTS_MODEL_MULTILINGUAL = 'eleven_flash_v2_5';
export const VOICE_ID = process.env.ELEVENLABS_VOICE_ID || 'cjVigY5qzO86Huf0OWal'; // "Eric", warm & clear

// Extra languages beyond the base `en`. Add 'tl' | 'vi' | 'zh' later (P2).
const EXTRA_LANGUAGES = ['es'] as const;

// Fields ElevenLabs extracts from the transcript after each call; read by post-call.ts.
const dataCollection = {
  zip: { type: 'string', description: "The caller's 5-digit zip code, if it was said or can be inferred from their location. Empty if unknown." },
  language: { type: 'string', description: 'Main language of the call as a code: en, es, tl, vi, or zh.' },
  site_id: { type: 'integer', description: 'The site_id of the site the agent recommended first, from the find_sites result. Empty if none.' },
  outcome: {
    type: 'string',
    description:
      'Exactly one of: escalated_911 (caller was told to call 911), sms_sent (a text was sent), ' +
      'site_given (a site was recommended, no text), no_site_found (no site available), ' +
      'abandoned (caller hung up before getting help), error (technical failure).',
  },
};

export function buildAgentBody(toolIds: string[]) {
  return {
    name: AGENT_NAME,
    tags: ['shade', 'sandhacks'],
    conversation_config: {
      agent: {
        language: 'en',
        first_message: read('prompts/first-message.en.txt'),
        prompt: {
          prompt: read('prompts/system.md'),
          llm: LLM,
          temperature: 0.3,
          tool_ids: toolIds,
          built_in_tools: {
            end_call: { type: 'system', name: 'end_call', description: '', params: { system_tool_type: 'end_call' } },
            language_detection: {
              type: 'system',
              name: 'language_detection',
              description: '',
              params: { system_tool_type: 'language_detection' },
            },
          },
        },
      },
      tts: { model_id: TTS_MODEL, voice_id: VOICE_ID },
      language_presets: Object.fromEntries(
        EXTRA_LANGUAGES.map((lang) => [
          lang,
          {
            overrides: {
              agent: { language: lang, first_message: read(`prompts/first-message.${lang}.txt`) },
              tts: { model_id: TTS_MODEL_MULTILINGUAL },
            },
          },
        ]),
      ),
    },
    platform_settings: { data_collection: dataCollection },
  };
}
