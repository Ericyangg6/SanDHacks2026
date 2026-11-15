import type { Language } from '../types';

// Deterministic pre-check that runs before the model, so a 911 escalation never depends on the LLM alone.

// NEEDS REVIEW by someone qualified (a clinician or public-health staff) before real users see it.
// These lists are an engineer's first guess, not medical guidance. They are biased toward a match: a 911 prompt
// sent by mistake costs less than a missed one. Known false positives to weigh in the review: "confused" ("I'm
// confused about the hours"), "dying" ("dying in this heat") and "emergency" ("is this an emergency alert?").
// Not in the lists yet, pending that review, and left to the model's milder-symptom guidance in ./instructions.ts:
// dizzy, lightheaded, nausea, headache, cramps, weak (mareado, mareada, nauseas, dolor de cabeza, calambres, debil).
// Phrases are written lowercase, without accents or apostrophes, as they are after normalize() below.
export const EMERGENCY_PHRASES: Record<'en' | 'es', readonly string[]> = {
  en: [
    'fainted', 'fainting', 'passed out', 'blacked out', 'collapsed', 'unconscious', 'unresponsive', 'not responding',
    'wont wake up', 'confused', 'disoriented', 'not making sense', 'slurred speech', 'seizure', 'convulsing',
    'stopped sweating', 'not sweating', 'hot dry skin', 'burning up', 'heat stroke', 'heatstroke',
    'cant breathe', 'cannot breathe', 'trouble breathing', 'short of breath', 'chest pain',
    'throwing up', 'vomiting', 'dying', 'emergency',
  ],
  es: [
    'me desmaye', 'se desmayo', 'desmayo', 'perdio el conocimiento', 'inconsciente', 'no responde', 'no despierta',
    'confundido', 'confundida', 'desorientado', 'desorientada', 'no sabe donde esta', 'convulsion', 'convulsiones',
    'dejo de sudar', 'no suda', 'piel caliente y seca', 'esta ardiendo', 'golpe de calor', 'insolacion',
    'no puedo respirar', 'no puede respirar', 'le cuesta respirar', 'falta de aire', 'dolor de pecho',
    'dolor en el pecho', 'vomitando', 'vomito', 'se esta muriendo', 'me muero', 'emergencia',
  ],
};

// Lowercase, no accents, no apostrophes (straight or curly), every other non-letter a single space, padded with
// spaces so a phrase can be matched on word boundaries with a plain substring test.
function normalize(text: string): string {
  const words = text
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/['‘’ʼ`]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
  return ` ${words} `;
}

// The language of the first phrase that matched, or null when none did. Third person ("my mom passed out")
// matches too. Negation ("not dizzy") is not parsed.
export function matchEmergency(body: string): { language: 'en' | 'es' } | null {
  const text = normalize(body);
  for (const language of ['en', 'es'] as const) {
    if (EMERGENCY_PHRASES[language].some((phrase) => text.includes(` ${phrase} `))) return { language };
  }
  return null;
}

// True when a text describes possible heat-illness or other emergency symptoms, in English or Spanish.
export function looksLikeEmergency(body: string): boolean {
  return matchEmergency(body) !== null;
}

// Fixed wording, so the escalation reads the same every time. Review it together with the phrase lists above.
const EMERGENCY_REPLY_EN =
  'This may be a medical emergency. Call 911 now. If you can, get to a cooler place while you wait. I am an automated AI assistant and cannot call 911 for you.';
// á, í, ó and ú are outside GSM-7, so this sends as UCS-2 (70 characters per segment).
const EMERGENCY_REPLY_ES =
  'Esto puede ser una emergencia médica. Llame al 911 ahora. Si puede, vaya a un lugar más fresco mientras espera. Soy un asistente automático de IA y no puedo llamar al 911 por usted.';

// The text sent when looksLikeEmergency matches.
export function emergencyReply(language: Language): string {
  // TODO: add tl, vi and zh, translated by a fluent speaker. Until then they fall back to English.
  return language === 'es' ? EMERGENCY_REPLY_ES : EMERGENCY_REPLY_EN;
}
