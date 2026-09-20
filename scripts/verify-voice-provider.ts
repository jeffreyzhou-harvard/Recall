/** Explicit live-provider smoke test. Uses a fixed Recall line; never a person's audio or a household graph. */
import { CALL_SCRIPT } from "@/fixtures";
import { recallVoice } from "@/server/recall-voice";
import { transcribe } from "@/server/transcribe";
const audio = await recallVoice(CALL_SCRIPT.lines.close_kind.text);
if (audio.length < 44 || audio.toString("ascii", 0, 4) !== "RIFF") throw new Error("The voice provider did not return WAV audio.");
const heard = await transcribe(audio);
if (heard.words.length < 3) throw new Error("The transcription provider did not return measured words.");
console.log(`Voice-provider verification passed: ${audio.length} WAV bytes, ${heard.words.length} time-aligned words. No household data used or stored.`);
