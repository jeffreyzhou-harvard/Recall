/**
 * Call control: how a live Relay session drives the video call.
 *
 * The session runs on the server (it holds the graph, the keys, and the thread
 * bridge). WebRTC only exists in browsers, so Relay's media endpoint is the
 * Relay web app's call page. These messages are the wire between them:
 *
 *   server --command--> Relay's call page --(data channel)--> her page
 *   server <----ack---- Relay's call page <--(data channel)-- her page
 *
 * Strict schemas, like signaling: the channel can carry these and nothing else.
 *
 * Relay's voice is rendered ON HER DEVICE with the browser's own speech
 * synthesis, from the exact text `render_prompt` produced, and shown on screen
 * labeled as Relay (rule 2). It is a plainly synthetic system voice - never her
 * voice, never a family member's, never cloned. Her own words are only ever
 * PLAYED BACK from the recording, never re-voiced.
 */
import { z } from "zod";

const id = z.string().min(1).max(200);
const ms = z.number().int().nonnegative();

/** Server -> Relay's call page. */
export const commandSchema = z.discriminatedUnion("type", [
  z.strictObject({ type: z.literal("say"), prompt_id: id, text: z.string().min(1).max(500) }),
  /** Play these spans of her own captured audio back to her, in order. Absolute call time. */
  z.strictObject({ type: z.literal("playback"), playback_id: id, spans: z.array(z.strictObject({ start_ms: ms, end_ms: ms })).min(1) }),
  z.strictObject({ type: z.literal("hangup") }),
]);
export type CallCommand = z.infer<typeof commandSchema>;

/** Relay's call page -> server. */
export const ackSchema = z.discriminatedUnion("type", [
  z.strictObject({ type: z.literal("connected") }),
  z.strictObject({ type: z.literal("said"), prompt_id: id }),
  z.strictObject({ type: z.literal("played"), playback_id: id }),
  z.strictObject({ type: z.literal("ended") }),
]);
export type CallAck = z.infer<typeof ackSchema>;

/** Over the WebRTC data channel, between the two pages. Her page only ever receives a line to say and reports that it said it. */
export const pageMessageSchema = z.discriminatedUnion("type", [
  z.strictObject({ type: z.literal("say"), prompt_id: id, text: z.string().min(1).max(500) }),
  z.strictObject({ type: z.literal("said"), prompt_id: id }),
]);
export type PageMessage = z.infer<typeof pageMessageSchema>;

export const CONTROL_CHANNEL = "relay-control";
