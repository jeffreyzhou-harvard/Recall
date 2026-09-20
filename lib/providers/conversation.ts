/** Conversational intent only. Never generates speech, confirms an answer, or writes a memory. */
export const CONVERSATION_INTENTS = ["detail", "acknowledgment", "unsure", "repeat", "clarification", "unrelated", "continuing"] as const;
export type ConversationIntent = typeof CONVERSATION_INTENTS[number];
export type ConversationAdvisor = (input: { topic: string; question: string; reply: string }) => Promise<ConversationIntent>;

/** Common repairs need no model round trip. Null leaves the existing observable-state rules in charge. */
export function conversationalRepair(text: string): ConversationIntent | null {
  const said = text.toLowerCase().replace(/’/g, "'").trim();
  if (/^(?:(?:oh|sorry|please|can you|could you|would you)\W+)*(?:repeat\b|say (?:that|it|the question) again\b|what did you say\b|i (?:didn't|did not|couldn't) (?:hear|catch)\b|pardon[.!?]*$)/.test(said)) return "repeat";
  if (/^(?:um\W*|uh\W*|well\W*|let me (?:think|remember|see)\W*|give me a (?:moment|second)\W*|one (?:moment|second)\W*|i'm thinking\W*)$/.test(said)) return "continuing";
  if (/^(?:what (?:do you mean|are you asking)|which (?:one|event|photo|picture)|can you explain)\b/.test(said)) return "clarification";
  // An explicit uncertainty followed by a concrete account is still her account.
  const afterBut = said.split(/\bbut\b/).at(-1) ?? "";
  if (/\b(?:don't|do not|can't|cannot) (?:remember|recall|know)\b.*\bbut\b/.test(said) && !said.endsWith("?")
    && afterBut.trim().split(/\s+/).length >= 4 && /\b(i|we|my|our|she|he|they)\b/.test(afterBut)
    && !/\b(?:don't|do not|can't|cannot|not sure|no idea|no clue)\b/.test(afterBut)) return "detail";
  // A question to Recall must not become a stored first-person memory merely for being four words long.
  if (/^(?:what|where|when|who|why|how|can you|could you|do you|did you|are you|is it|was it)\b/.test(said) && said.endsWith("?")) return "clarification";
  return null;
}
