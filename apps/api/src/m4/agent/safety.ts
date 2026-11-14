import { notImplemented } from '../todo';
import type { Language } from '../types';

// Deterministic pre-check that runs before the model, so a 911 escalation never depends on the LLM alone.

// True when a text describes possible heat-illness or other emergency symptoms, in English or Spanish.
export function looksLikeEmergency(body: string): boolean {
  // TODO: NEEDS REVIEW by someone qualified (a clinician or public-health staff) before real users see it.
  //       The phrase lists below are an engineer's first guess, not medical guidance.
  // TODO: 1. Normalize the body: lowercase, strip accents (normalize('NFD') and drop combining marks),
  //          straighten curly apostrophes, collapse whitespace.
  // TODO: 2. Match these English phrases on word boundaries:
  //          fainted, fainting, passed out, blacked out, collapsed, unconscious, unresponsive, not responding,
  //          won't wake up, confused, disoriented, not making sense, slurred speech, seizure, convulsing,
  //          stopped sweating, not sweating, hot dry skin, burning up, heat stroke, heatstroke,
  //          can't breathe, cannot breathe, trouble breathing, short of breath, chest pain,
  //          throwing up, vomiting, dying, emergency.
  // TODO: 3. Match these Spanish phrases (written here without accents, as they are after step 1):
  //          me desmaye, se desmayo, desmayo, perdio el conocimiento, inconsciente, no responde, no despierta,
  //          confundido, confundida, desorientado, desorientada, no sabe donde esta, convulsion, convulsiones,
  //          dejo de sudar, no suda, piel caliente y seca, esta ardiendo, golpe de calor, insolacion,
  //          no puedo respirar, no puede respirar, le cuesta respirar, falta de aire, dolor de pecho,
  //          dolor en el pecho, vomitando, vomito, se esta muriendo, me muero, emergencia.
  // TODO: 4. Decide the borderline terms with the reviewer: dizzy, lightheaded, nausea, headache, cramps, weak
  //          (mareado, mareada, nauseas, dolor de cabeza, calambres, debil). Either they trigger 911 here or
  //          they are left to the model's milder-symptom guidance in ./instructions.ts.
  // TODO: 5. Bias toward true: a 911 prompt sent by mistake costs less than a missed one. Third person
  //          ("my mom passed out") must match. Do not try to parse negation ("not dizzy") in the first version.
  // TODO: 6. Keep the phrases in one exported list so the reviewer can read them, and table-test it with
  //          sample texts in both languages, typos and missing accents included.
  return notImplemented('safety.looksLikeEmergency');
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
