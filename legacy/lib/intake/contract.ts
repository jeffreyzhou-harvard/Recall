/**
 * What Recall ingests when a relative forwards an ask - and, just as much, what
 * it refuses to (rule 8, data minimization).
 *
 * The schema is strict: a bridge cannot pass chat history, other messages,
 * contacts, or location along with the ask, because there is no field to put
 * them in and unknown fields are rejected.
 */
import { z } from "zod";

/** "A current question plus up to one photo" (product flow spec; AGENTS.md rule 8). Not configurable per family. */
export const MAX_PHOTOS_PER_ASK = 1;

const id = z.string().min(1);

export const forwardedAskSchema = z.strictObject({
  /** The bridge's id for the forwarded message. Makes a repeated delivery of the same forward a no-op. */
  forward_id: id,
  /** The family's existing thread. The answer goes back here and nowhere else. */
  thread_id: id,
  /** Who forwarded it, as the bridge bound them. Verified later against the joint setup, never trusted here. */
  asker_id: id,
  addressee_id: id,
  text: z.string().trim().min(1).max(500),
  photos: z.array(z.strictObject({ asset_id: id, caption: z.string().trim().max(200).nullable() })),
  requested_audience: id,
  received_at: z.iso.datetime(),
});
export type ForwardedAsk = z.infer<typeof forwardedAskSchema>;

export const INTAKE_REJECTIONS = [
  "invalid_payload",
  "too_many_photos",
  "unknown_asset",
  /** The thread, asker, or addressee is not someone the joint setup knows. Nothing about them is written down. */
  "unknown_party",
] as const;
export type IntakeRejection = (typeof INTAKE_REJECTIONS)[number];

export class IntakeError extends Error {
  constructor(
    public readonly code: IntakeRejection,
    detail: string,
  ) {
    super(`intake rejected (${code}): ${detail}`);
    this.name = "IntakeError";
  }
}

export function parseForwardedAsk(raw: unknown): ForwardedAsk {
  const parsed = forwardedAskSchema.safeParse(raw);
  if (!parsed.success) {
    throw new IntakeError("invalid_payload", parsed.error.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`).join("; "));
  }
  if (parsed.data.photos.length > MAX_PHOTOS_PER_ASK) {
    throw new IntakeError("too_many_photos", `an ask carries at most ${MAX_PHOTOS_PER_ASK} photo; got ${parsed.data.photos.length}`);
  }
  return parsed.data;
}
