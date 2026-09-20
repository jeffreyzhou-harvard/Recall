/** Local silence corroborates the streaming endpoint; neither alone proves a thought is finished. */
export type SpeechPreview = { text: string; endpointMs: number | null; unavailable: boolean };

export function holdingThought(text: string): boolean {
  const words = text.toLowerCase().replace(/[’]/g, "'").replace(/[^\p{L}'\s]/gu, "").trim();
  return /\b(and|but|because|so|then|with|when|while|the|a|an|to|of|or|um|uh|well)$/.test(words)
    || /\b(let me (think|remember|see)|give me a (moment|second)|hang on|one moment|i'm thinking)$/.test(words);
}

export function shouldFinishTurn(elapsedMs: number, lastVoiceMs: number | null, preview: SpeechPreview | null): boolean {
  if (elapsedMs >= 75_000) return true;
  if (lastVoiceMs === null && preview && !preview.unavailable && preview.text.trim() && preview.endpointMs != null && preview.endpointMs <= elapsedMs) lastVoiceMs = preview.endpointMs;
  if (lastVoiceMs === null) return elapsedMs >= 25_000;
  const quietMs = elapsedMs - lastVoiceMs;
  // Give unfinished phrases the original thinking pause. Fresh speech invalidates an older endpoint.
  if (preview && !preview.unavailable && holdingThought(preview.text)) return quietMs >= 6500;
  const endpoint = preview?.endpointMs;
  const confirmedPause = preview && !preview.unavailable && preview.text.trim() && endpoint != null
    && endpoint >= lastVoiceMs - 300 && endpoint <= elapsedMs;
  return quietMs >= (confirmedPause ? 1400 : 3500);
}
